import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { openMic } from '../lib/mic.mjs';

const source = 'BotSink_safety.monitor';
const pcm = Buffer.from([0x10, 0x27, 0xf0, 0xd8]);
function setup(extra = {}) {
  const children = [], errors = [];
  let cleanups = 0;
  const mic = openMic({ pulseSource: source, onError: e => errors.push(e),
    prepareBotRecorderImpl: value => {
      assert.equal(value, source);
      return { command: 'rec', args: [], options: {}, cleanup() { cleanups++; } };
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdio = [null, child.stdout, child.stderr, new PassThrough()];
      child.killed = false; child.kill = () => { child.killed = true; };
      children.push(child); return child;
    }, ...extra
  });
  return { mic, children, errors, get cleanups() { return cleanups; } };
}
const ready = child => child.stdio[3].write('PTK_NO_MOVE_V1\n');

test('確認前PCMは破棄し、分割された移動禁止確認後のPCMだけを採用する', () => {
  const s = setup(); assert.equal(s.mic.start(), true);
  const c = s.children[0]; c.stdout.write(pcm); assert.equal(s.mic.take(2), null);
  c.stdio[3].write('PTK_NO_'); c.stdout.write(pcm); assert.equal(s.mic.take(2), null);
  c.stdio[3].write('MOVE_V1\n'); c.stdout.write(pcm);
  assert.deepEqual([...s.mic.take(2)], [10000, -10000]); s.mic.stop();
});

test('不正な確認・確認なし終了はfail-closedで一度だけ警告する', () => {
  for (const action of [c => c.stdio[3].write('WRONG\n'), c => c.stdio[3].end()]) {
    const s = setup(); s.mic.start(); const c = s.children[0]; action(c);
    c.stdout.write(pcm); c.emit('exit', 1); c.emit('close', 1);
    assert.equal(s.mic.running, false); assert.equal(s.mic.take(2), null);
    assert.equal(s.errors.length, 1); assert.equal(s.cleanups, 1); assert.equal(c.killed, true);
  }
});

test('確認timeoutでも既定マイクを起動しない', async () => {
  const s = setup({ readyTimeoutMs: 5 }); s.mic.start();
  await delay(20);
  assert.equal(s.mic.running, false); assert.equal(s.children.length, 1);
  assert.equal(s.errors.length, 1); assert.equal(s.cleanups, 1);
});

test('録音異常終了時に未送信PCMとメーターを破棄する', () => {
  const s = setup(); s.mic.start(); const c = s.children[0]; ready(c); c.stdout.write(pcm);
  assert.equal(s.mic.level(), 10000); c.emit('exit', 1);
  assert.equal(s.mic.take(2), null); assert.equal(s.mic.level(), 0);
  assert.deepEqual(s.mic.readMeter(), { rms: 0, peak: 0, samples: 0 });
  c.stdout.write(pcm); assert.equal(s.mic.take(2), null); assert.equal(s.errors.length, 1);
});

test('stop/start後の旧プロセスのPCM・exitは新しい録音へ干渉しない', () => {
  const s = setup(); s.mic.start(); const old = s.children[0]; ready(old);
  s.mic.stop(); s.mic.start(); const current = s.children[1]; ready(current);
  old.stdout.write(pcm); old.emit('exit', 0); old.emit('error', new Error('late'));
  assert.equal(s.mic.running, true); assert.equal(s.mic.take(2), null);
  current.stdout.write(pcm); assert.deepEqual([...s.mic.take(2)], [10000, -10000]);
  assert.deepEqual(s.errors, []); s.mic.stop(); assert.equal(s.cleanups, 2);
});

test('補助コード未ビルド・spawn同期例外では録音しない', () => {
  let spawns = 0;
  const a = setup({ prepareBotRecorderImpl() { throw new Error('build required'); }, spawnImpl() { spawns++; } });
  assert.equal(a.mic.start(), false); assert.equal(spawns, 0); assert.equal(a.errors.length, 1);
  const b = setup({ spawnImpl() { throw new Error('spawn failed'); } });
  assert.equal(b.mic.start(), false); assert.equal(b.cleanups, 1); assert.equal(b.errors.length, 1);
});

test('通常のマイク経路は補助コードやBOT環境を使わない', () => {
  const calls = []; const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const mic = openMic({ prepareBotRecorderImpl() { throw new Error('must not run'); }, spawnImpl(...args) { calls.push(args); return child; } });
  mic.start(); child.stdout.write(pcm); assert.deepEqual([...mic.take(2)], [10000, -10000]);
  assert.equal(calls[0][0], 'rec'); assert.equal(calls[0][2].env, undefined); mic.stop();
});

test('大きいPCMチャンクでも直近200msを保持し全廃棄しない', () => {
  const s = setup(); s.mic.start(); const c = s.children[0]; ready(c);
  const large = Buffer.alloc(32768); large.writeInt16LE(12345, large.length - 2);
  c.stdout.write(large);
  const samples = s.mic.take(9600);
  assert.equal(samples.length, 9600); assert.equal(samples.at(-1), 12345);
  assert.equal(s.mic.take(1), null); s.mic.stop();
});

test('移動禁止確認後もPCMが届かない・途切れる場合は停止する', async () => {
  for (const withInitialAudio of [false, true]) {
    const s = setup({ readyTimeoutMs: 5 }); s.mic.start(); const c = s.children[0]; ready(c);
    if (withInitialAudio) c.stdout.write(pcm);
    await delay(20);
    assert.equal(s.mic.running, false); assert.equal(s.mic.take(2), null);
    assert.equal(s.errors.length, 1); assert.match(s.errors[0], /PCM/);
    assert.equal(s.children.length, 1);
  }
});
