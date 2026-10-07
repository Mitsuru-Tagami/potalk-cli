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
