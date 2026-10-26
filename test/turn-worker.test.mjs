import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleTurnRequest } from '../worker/pot-turn-cli.js';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const TOKEN = 'device-token-xyz';
const ENV = {
  TURN_KEY_ID: 'key-id-123',
  TURN_KEY_API_TOKEN: 'cf-api-token',
  CLI_TURN_TOKENS: JSON.stringify({ testbox: sha256(TOKEN) })
};
const ICE = [{ urls: 'turn:turn.cloudflare.com:3478', username: 'u', credential: 'p' }];

function upstreamOk(extra = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ iceServers: ICE, ...extra }) };
  };
  return { calls, fetchImpl };
}
const get = headers => new Request('https://pot-turn-cli.example.workers.dev/', { headers });
const authed = () => get({ Authorization: `Bearer ${TOKEN}` });

test('Worker：トークンが無ければ 403 で、上流を叩かない', async () => {
  const { calls, fetchImpl } = upstreamOk();
  const res = await handleTurnRequest(get({}), ENV, fetchImpl);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('Worker：間違ったトークンは 403 で、上流を叩かない', async () => {
  const { calls, fetchImpl } = upstreamOk();
  const res = await handleTurnRequest(get({ Authorization: 'Bearer wrong-token' }), ENV, fetchImpl);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('Worker：CLI_TURN_TOKENS が未設定なら正しい形式のトークンでも 403（fail-closed）', async () => {
  const { calls, fetchImpl } = upstreamOk();
  const env = { TURN_KEY_ID: ENV.TURN_KEY_ID, TURN_KEY_API_TOKEN: ENV.TURN_KEY_API_TOKEN };
  const res = await handleTurnRequest(authed(), env, fetchImpl);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('Worker：CLI_TURN_TOKENS が不正な JSON なら 403（fail-closed）', async () => {
  const { calls, fetchImpl } = upstreamOk();
  const res = await handleTurnRequest(authed(), { ...ENV, CLI_TURN_TOKENS: '{not json' }, fetchImpl);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('Worker：正しいトークンなら 200 で iceServers のみ返し、上流には ttl 14400 で取りに行く', async () => {
  const { calls, fetchImpl } = upstreamOk({ extraField: 'must-not-leak' });
  const res = await handleTurnRequest(authed(), ENV, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['iceServers']);
  assert.deepEqual(body.iceServers, ICE);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key-id-123/credentials/generate-ice-servers');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer cf-api-token');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { ttl: 14400 });
});

test('Worker：複数端末のうち登録済みのどれか1つで通る', async () => {
  const { fetchImpl } = upstreamOk();
  const env = {
    ...ENV,
    CLI_TURN_TOKENS: JSON.stringify({ a: sha256('token-a'), b: sha256('token-b') })
  };
  const res = await handleTurnRequest(get({ Authorization: 'Bearer token-b' }), env, fetchImpl);
  assert.equal(res.status, 200);
});

test('Worker：上流が失敗したら 502 で文面を丸める', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: 'upstream detail' }) });
  const res = await handleTurnRequest(authed(), ENV, fetchImpl);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'turn unavailable' });
});

test('Worker：上流が iceServers を返さなければ 502', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ iceServers: [] }) });
  const res = await handleTurnRequest(authed(), ENV, fetchImpl);
  assert.equal(res.status, 502);
});

test('Worker：TURN キーが未設定なら 502 で、上流を叩かない', async () => {
  const { calls, fetchImpl } = upstreamOk();
  const env = { CLI_TURN_TOKENS: ENV.CLI_TURN_TOKENS };
  const res = await handleTurnRequest(authed(), env, fetchImpl);
  assert.equal(res.status, 502);
  assert.equal(calls.length, 0);
});

test('Worker：GET 以外は 405 で、上流を叩かない', async () => {
  const { calls, fetchImpl } = upstreamOk();
  const req = new Request('https://pot-turn-cli.example.workers.dev/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const res = await handleTurnRequest(req, ENV, fetchImpl);
  assert.equal(res.status, 405);
  assert.equal(calls.length, 0);
});
