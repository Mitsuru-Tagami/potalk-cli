import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMono48k } from '../lib/audio.mjs';

test('toMono48k：ステレオは左右の平均', () => {
  const out = toMono48k({ samples: Int16Array.from([100, 300, -200, 0]), sampleRate: 48000, channelCount: 2, numberOfFrames: 2 });
  assert.deepEqual([...out], [200, -100]);
});

test('toMono48k：48kHz 以外は 48kHz に直す（長さが比例する）', () => {
  const out = toMono48k({ samples: new Int16Array(160), sampleRate: 16000, channelCount: 1, numberOfFrames: 160 });
  assert.equal(out.length, 480);
});

import { LoudGuard, LOUD_GAIN } from '../lib/audio.mjs';

// 100ms 窓（4800 サンプル）を n 個ぶん流すヘルパー
const feedWindows = (guard, samples, windows) => {
  for (let w = 0; w < windows; w++) guard.observe(samples);
};
const windowOf = fill => {
  const a = new Float32Array(4800);
  for (let i = 0; i < a.length; i++) a[i] = fill(i);
  return a;
};
const sineWindow = rms => windowOf(i => Math.round(Math.sqrt(2) * rms * Math.sin(2 * Math.PI * i / 48)));

test('大音量ガード：ふつうの声（RMS 0.15）では効かない', () => {
  const g = new LoudGuard();
  feedWindows(g, sineWindow(0.15 * 32768), 30);   // 3 秒ぶん
  assert.equal(g.loud, false);
  assert.equal(g.gain, 1);
});

test('大音量ガード：RMS 0.9 が約0.4秒続くと効き、ゲインが半分になる', () => {
  let calls = 0;
  const g = new LoudGuard(() => calls++);
  feedWindows(g, sineWindow(0.9 * 32768), 3);     // 0.3 秒ではまだ
  assert.equal(g.loud, false);
  feedWindows(g, sineWindow(0.9 * 32768), 1);     // 0.4 秒で発動
  assert.equal(g.loud, true);
  assert.equal(g.gain, LOUD_GAIN);
  assert.equal(calls, 1);
  feedWindows(g, sineWindow(0.15 * 32768), 20);  // 静かになってもセッション中は維持し、通知は一度だけ
  assert.equal(g.loud, true);
  assert.equal(calls, 1);
});

test('大音量ガード：音割れが多い信号は RMS が低めでも検知する', () => {
  const g = new LoudGuard();
  // 20% のサンプルがほぼ全振幅（音割れ）、残りは無音 → RMS は約 0.44相当で RMS 基準未満、音割れ率 20% ≥ 15%
  const spiky = windowOf(i => (i % 5 === 0 ? 32500 : 0));
  feedWindows(g, spiky, 4);
  assert.equal(g.loud, true);
});

test('大音量ガード：短いバースト（0.2秒）では効かない', () => {
  const g = new LoudGuard();
  feedWindows(g, sineWindow(0.9 * 32768), 2);
  feedWindows(g, sineWindow(0.15 * 32768), 30);
  assert.equal(g.loud, false);
  assert.equal(g.gain, 1);
});
