import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnLoader, createLiveTrysteroConfig } from '../lib/turn.mjs';

const ICE = [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }];
const okResponse = () => ({ ok: true, status: 200, json: async () => ({ iceServers: ICE }) });
const ENV = { POTALK_TURN_WORKER_URL: 'https://turn.example.workers.dev/', POTALK_TURN_TOKEN: 'tok-abc' };

function makeLoader({ env = ENV, respond = okResponse, nowStart = 1_000_000 } = {}) {
  const calls = [];
  const warnings = [];
  let t = nowStart;
  const loader = createTurnLoader({
    env,
    now: () => t,
    warn: (...a) => warnings.push(a.join(' ')),
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return respond(); }
  });
  return { loader, calls, warnings, advance: ms => { t += ms; } };
}

test('TURN：環境変数が未設定なら null（fetch しない・警告もしない）', async () => {
  const { loader, calls, warnings } = makeLoader({ env: {} });
  assert.equal(loader.configured, false);
  assert.equal(await loader.loadTurnRtcConfig(), null);
  assert.equal(calls.length, 0);
  assert.equal(warnings.length, 0);
});

test('TURN：片方だけ設定しても無効', async () => {
  for (const env of [{ POTALK_TURN_WORKER_URL: ENV.POTALK_TURN_WORKER_URL }, { POTALK_TURN_TOKEN: ENV.POTALK_TURN_TOKEN }]) {
    const { loader, calls } = makeLoader({ env });
    assert.equal(await loader.loadTurnRtcConfig(), null);
    assert.equal(calls.length, 0);
  }
});

test('TURN：成功したら relay 付きの rtcConfig を返し、Bearer で Worker を叩く', async () => {
  const { loader, calls, warnings } = makeLoader();
  const config = await loader.loadTurnRtcConfig();
  assert.deepEqual(config, { iceServers: ICE, iceTransportPolicy: 'relay' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENV.POTALK_TURN_WORKER_URL);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok-abc');
  assert.equal(warnings.length, 0);
});

test('TURN：HTTP エラーなら null＋警告（IP が見える状態である旨）', async () => {
  const { loader, warnings } = makeLoader({ respond: () => ({ ok: false, status: 403, json: async () => ({}) }) });
  assert.equal(await loader.loadTurnRtcConfig(), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /STUN 直結/);
});

test('TURN：通信例外でも null＋警告', async () => {
  const { loader, warnings } = makeLoader({ respond: () => { throw new Error('network down'); } });
  assert.equal(await loader.loadTurnRtcConfig(), null);
  assert.equal(warnings.length, 1);
});

test('TURN：応答の形が不正（iceServers が空）なら null＋警告', async () => {
  const { loader, warnings } = makeLoader({ respond: () => ({ ok: true, status: 200, json: async () => ({ iceServers: [] }) }) });
  assert.equal(await loader.loadTurnRtcConfig(), null);
  assert.equal(warnings.length, 1);
});

test('TURN：10分キャッシュが効き、過ぎたら取り直す', async () => {
  const { loader, calls, advance } = makeLoader();
  await loader.loadTurnRtcConfig();
  await loader.loadTurnRtcConfig();
  assert.equal(calls.length, 1);
  advance(10 * 60 * 1000 + 1);
  await loader.loadTurnRtcConfig();
  assert.equal(calls.length, 2);
});

test('TURN：失敗もキャッシュされ、叩き直しと警告の連打をしない', async () => {
  const { loader, calls, warnings } = makeLoader({ respond: () => ({ ok: false, status: 502, json: async () => ({}) }) });
  assert.equal(await loader.loadTurnRtcConfig(), null);
  assert.equal(await loader.loadTurnRtcConfig(), null);
  assert.equal(calls.length, 1);
  assert.equal(warnings.length, 1);
});

test('TURN：同時呼び出しは1回の fetch にまとまる', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { loader, calls } = makeLoader({ respond: async () => { await gate; return okResponse(); } });
  const p1 = loader.loadTurnRtcConfig();
  const p2 = loader.loadTurnRtcConfig();
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, { iceServers: ICE, iceTransportPolicy: 'relay' });
  assert.deepEqual(b, a);
});

function stubLoader() {
  const state = { value: null, fetchedAt: 0, configured: true };
  return {
    state,
    configured: true,
    loadTurnRtcConfig: async () => state.value,
    cachedTurnRtcConfig: () => (state.value ? { value: state.value, fetchedAt: state.fetchedAt } : (state.fetchedAt ? { value: null, fetchedAt: state.fetchedAt } : null))
  };
}

test('live config：リフレッシュで rtcConfig が差し替わり、失敗時は前回値を保持する', async () => {
  const loader = stubLoader();
  const live = createLiveTrysteroConfig(loader, { warn: () => {}, setIntervalImpl: () => ({ unref() {} }) });
  assert.equal(live.config.appId, 'kuramo-webrtc-call');
  assert.equal(live.config.rtcConfig, undefined);

  loader.state.value = { iceServers: ICE, iceTransportPolicy: 'relay' };
  loader.state.fetchedAt = Date.now();
  await live.refresh();
  assert.deepEqual(live.config.rtcConfig, { iceServers: ICE, iceTransportPolicy: 'relay' });

  loader.state.value = null;   // 次のリフレッシュは失敗
  await live.refresh();
  assert.deepEqual(live.config.rtcConfig, { iceServers: ICE, iceTransportPolicy: 'relay' }, '寿命のうちは前回値を保持');
});

test('live config：更新できないまま資格情報の寿命を超えたら rtcConfig を落とす', async () => {
  const loader = stubLoader();
  const warnings = [];
  let t = 5_000_000;
  const live = createLiveTrysteroConfig(loader, {
    now: () => t,
    warn: (...a) => warnings.push(a.join(' ')),
    setIntervalImpl: () => ({ unref() {} }),
    credentialTtlMs: 1000
  });
  loader.state.value = { iceServers: ICE, iceTransportPolicy: 'relay' };
  loader.state.fetchedAt = t;
  await live.refresh();
  assert.ok(live.config.rtcConfig);

  loader.state.value = null;
  t += 1001;   // 最後の成功から寿命を超過
  await live.refresh();
  assert.equal(live.config.rtcConfig, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /STUN 直結/);
});

test('live config：未設定のローダーでは start してもタイマーが始まらない', () => {
  let intervalCalls = 0;
  const live = createLiveTrysteroConfig(
    { configured: false, loadTurnRtcConfig: async () => null, cachedTurnRtcConfig: () => null },
    { setIntervalImpl: () => { intervalCalls++; return { unref() {} }; } }
  );
  live.start();
  assert.equal(intervalCalls, 0);
  assert.equal(live.config.rtcConfig, undefined);
});

test('live config：start で即リフレッシュされ、間隔タイマーも登録される', async () => {
  const loader = stubLoader();
  loader.state.value = { iceServers: ICE, iceTransportPolicy: 'relay' };
  loader.state.fetchedAt = Date.now();
  let tickFn = null;
  const live = createLiveTrysteroConfig(loader, {
    warn: () => {},
    setIntervalImpl: fn => { tickFn = fn; return { unref() {} }; }
  });
  live.start();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(live.config.rtcConfig, { iceServers: ICE, iceTransportPolicy: 'relay' });
  assert.equal(typeof tickFn, 'function');
  live.stop();
});
