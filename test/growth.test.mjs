import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { growthStage, loadGrowthStats, sanitizeGrowthStage, startGrowthSession } from '../lib/growth.mjs';

const stats = (minutes, joins, days) => ({ seconds: Math.floor(minutes * 60), joins, days, lastDay: '' });

test('growthStage: 本家と同じ各段階の境界条件を使う', () => {
  assert.equal(growthStage(stats(4.99, 3, 1)), '🌱');
  assert.equal(growthStage(stats(5, 3, 1)), '🌿');
  assert.equal(growthStage(stats(60, 10, 3)), '🌿'); // 日数が足りない
  assert.equal(growthStage(stats(60, 9, 4)), '🌿'); // 参加回数が足りない
  assert.equal(growthStage(stats(60, 10, 4)), '🌷');
  assert.equal(growthStage(stats(120, 10, 4)), '🌻'); // 平均12分以上
  assert.equal(growthStage(stats(180, 20, 13)), '🌷'); // 木の日数が足りないため花段階
  assert.equal(growthStage(stats(180, 20, 14)), '🌲');
  assert.equal(growthStage(stats(240, 20, 14)), '🌳'); // 平均12分以上
});

test('startGrowthSession: 参加回数・日数を記録し、同じ日の複数回参加は日数を重ねない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-growth-'));
  const file = path.join(dir, 'growth.json');
  try {
    const first = startGrowthSession({ now: new Date(2026, 0, 10, 23, 59), file });
    assert.deepEqual(first.stats(), { seconds: 0, joins: 1, days: 1, lastDay: '2026-1-10' });
    assert.equal(first.addTime(30), '🌱');
    const second = startGrowthSession({ now: new Date(2026, 0, 10, 23, 59), file });
    assert.deepEqual(second.stats(), { seconds: 30, joins: 2, days: 1, lastDay: '2026-1-10' });
    second.addTime(270);
    assert.deepEqual(loadGrowthStats(file), { seconds: 300, joins: 2, days: 1, lastDay: '2026-1-10' });
    const nextDay = startGrowthSession({ now: new Date(2026, 0, 11, 0, 1), file });
    assert.deepEqual(nextDay.stats(), { seconds: 300, joins: 3, days: 2, lastDay: '2026-1-11' });
    assert.equal(nextDay.stage(), '🌿');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGrowthStats: 壊れた保存データから空の記録へ安全に戻る', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-growth-'));
  const file = path.join(dir, 'growth.json');
  try {
    fs.writeFileSync(file, '{broken');
    assert.deepEqual(loadGrowthStats(file), { seconds: 0, joins: 0, days: 0, lastDay: '' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizeGrowthStage: 既知の段階だけを通し、任意の文字列を除外する', () => {
  assert.equal(sanitizeGrowthStage('🌷'), '🌷');
  assert.equal(sanitizeGrowthStage('🌱\u001b[31m'), '');
  assert.equal(sanitizeGrowthStage({ stage: '🌳' }), '');
});
