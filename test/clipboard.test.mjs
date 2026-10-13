import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createClipboardWriter } from '../lib/clipboard.mjs';

function fakeChild({ code = 0, stderr = '' } = {}) {
  const child = new EventEmitter();
  const chunks = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    if (stderr) child.stderr.end(stderr);
    child.emit('close', code, null);
  });
  return { child, chunks };
}

test('createClipboardWriter：Linux Waylandではwl-copyを優先し、シェルを介さず本文を渡す', async () => {
  const calls = [];
  const writer = createClipboardWriter({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' },
    spawnProcess(command, args, options) {
      const result = fakeChild();
      calls.push({ command, args, options, result });
      return result.child;
    }
  });

  await writer('https://example.test/#room=a b');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'wl-copy');
  assert.deepEqual(calls[0].args, []);
  assert.deepEqual(calls[0].options.stdio, ['pipe', 'ignore', 'pipe']);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(Buffer.concat(calls[0].result.chunks).toString(), 'https://example.test/#room=a b');
});

test('createClipboardWriter：Waylandコマンドがない場合にX11候補へフォールバックする', async () => {
  const calls = [];
  const missing = Object.assign(new Error('not found'), { code: 'ENOENT' });
  const writer = createClipboardWriter({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' },
    spawnProcess(command) {
      calls.push(command);
      if (command === 'wl-copy') throw missing;
      return fakeChild().child;
    }
  });

  await writer('room-url');

  assert.deepEqual(calls, ['wl-copy', 'xclip']);
});

test('createClipboardWriter：spawnの非同期ENOENTイベントでも次の候補へ進む', async () => {
  const calls = [];
  const writer = createClipboardWriter({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' },
    spawnProcess(command) {
      calls.push(command);
      if (command !== 'wl-copy') return fakeChild().child;

      const child = new EventEmitter();
      child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      child.stderr = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
        child.emit('close', -2, null);
      });
      return child;
    }
  });

  await writer('room-url');

  assert.deepEqual(calls, ['wl-copy', 'xclip']);
});

test('createClipboardWriter：OS標準コマンドの終了失敗は原因を含めて報告する', async () => {
  const writer = createClipboardWriter({
    platform: 'linux',
    env: { DISPLAY: ':0' },
    spawnProcess() {
      return fakeChild({ code: 1, stderr: 'clipboard unavailable' }).child;
    }
  });

  await assert.rejects(writer('room-url'), /xclip: clipboard unavailable/);
});

test('createClipboardWriter：macOSとWindowsではOS標準ツールを選ぶ', async () => {
  for (const [platform, expected] of [['darwin', 'pbcopy'], ['win32', 'clip.exe']]) {
    const calls = [];
    const writer = createClipboardWriter({
      platform,
      env: {},
      spawnProcess(command) {
        calls.push(command);
        return fakeChild().child;
      }
    });
    await writer('room-url');
    assert.deepEqual(calls, [expected]);
  }
});
