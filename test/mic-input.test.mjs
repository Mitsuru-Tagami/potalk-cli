import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describeMicLevels, dbfs, formatMicMeter, measureInt16 } from '../lib/mic-level.mjs';
import { captureMicTest, playCapturedAudio } from '../lib/mic-diagnostic.mjs';
import { openMic } from '../lib/mic.mjs';

function pcm16(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = signal => {
    child.stdout.end();
    child.stderr.end();
    queueMicrotask(() => child.emit('close', null, signal));
  };
  return child;
}

test('入力レベル計算はRMS・ピーク・フルスケール近傍を測る', () => {
  const levels = measureInt16(Int16Array.from([10000, -10000, 0, 32767]));
  assert.equal(levels.samples, 4);
  assert.ok(Math.abs(levels.rms - Math.sqrt((10000 ** 2 + 10000 ** 2 + 32767 ** 2) / 4)) < 0.001);
  assert.equal(levels.peak, 32767);
  assert.equal(levels.clippedSamples, 1);
  assert.equal(dbfs(32768), 0);
  assert.match(formatMicMeter({ rms: 0, peak: 0 }), /RMS -∞ dBFS/u);
});

test('診断は無音に近い・小さい・高ピークを区別する目安を返す', () => {
  assert.match(describeMicLevels({ rms: 0, peak: 0 }).join(' '), /無音に近い/u);
  assert.match(describeMicLevels({ rms: 500, peak: 1500 }).join(' '), /小さめ/u);
  const loud = describeMicLevels({ rms: 2000, peak: 32700 }).join(' ');
  assert.match(loud, /音声入力/u);
  assert.match(loud, /音割れ/u);
});

test('通話中マイクはSoXから届いた区間RMSとピークを読み出せる', () => {
  const child = fakeChild();
  const mic = openMic({ spawnImpl: () => child });
  mic.start();
  child.stdout.write(pcm16([3000, -3000, 0]));
  assert.equal(mic.level(), Math.sqrt(6_000_000));
  assert.deepEqual(mic.readMeter(), { rms: Math.sqrt(6_000_000), peak: 3000, samples: 3 });
  assert.deepEqual(mic.readMeter(), { rms: 0, peak: 0, samples: 0 });
  mic.stop();
  assert.equal(mic.running, false);
});

test('マイク診断はSoXのrecからPCMをRAM上で測り、設定時間後に録音を止める', async () => {
  const child = fakeChild();
  const calls = [];
  const capture = captureMicTest({
    durationMs: 10,
    spawnImpl: (command, args, options) => { calls.push({ command, args, options }); return child; }
  });
  setTimeout(() => child.stdout.write(pcm16([4000, -4000, 2000])), 1);
  const result = await capture;
  assert.equal(result.ok, true);
  assert.equal(calls[0].command, 'rec');
  assert.deepEqual(calls[0].args.slice(-2), ['1', '-']);
  assert.deepEqual([...Array.from({ length: result.stats.samples }, (_, i) => result.buffer.readInt16LE(i * 2))], [4000, -4000, 2000]);
  assert.equal(result.stats.peak, 4000);
  assert.equal(result.stats.clippedSamples, 0);
});

test('測定音声は一時ファイルを作らずSoX playのstdinへ渡す', async () => {
  const player = new EventEmitter();
  const received = [];
  player.stderr = new PassThrough();
  player.stdin = new Writable({
    write(chunk, _encoding, callback) { received.push(Buffer.from(chunk)); callback(); },
    final(callback) { callback(); queueMicrotask(() => player.emit('close', 0)); }
  });
  const pcm = pcm16([1234, -4321]);
  const result = await playCapturedAudio(pcm, { spawnImpl: (command, args, options) => {
    assert.equal(command, 'play');
    assert.deepEqual(options.stdio, ['pipe', 'ignore', 'pipe']);
    return player;
  } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(Buffer.concat(received), pcm);
});
