import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DICE_SIDES, rollDice } from '../lib/dice.mjs';

test('rollDice: 引数なしは6面で1〜6を返す', () => {
  let range;
  const result = rollDice('', { randomIntImpl: (min, max) => { range = [min, max]; return min; } });
  assert.deepEqual(result, { ok: true, sides: 6, result: 1 });
  assert.deepEqual(range, [1, 7]);
});

test('rollDice: 指定面数は1〜Nの均等抽選範囲を使う', () => {
  let range;
  const result = rollDice('20', { randomIntImpl: (min, max) => { range = [min, max]; return max - 1; } });
  assert.deepEqual(result, { ok: true, sides: 20, result: 20 });
  assert.deepEqual(range, [1, 21]);
});

test('rollDice: crypto.randomIntの最大対応面数を上限値として受け付ける', () => {
  let range;
  const result = rollDice(String(MAX_DICE_SIDES), {
    randomIntImpl: (min, max) => { range = [min, max]; return max - 1; }
  });
  assert.deepEqual(result, { ok: true, sides: MAX_DICE_SIDES, result: MAX_DICE_SIDES });
  assert.deepEqual(range, [1, 2 ** 48]);
});

test('rollDice: 0以下・非整数・余分な引数・上限超過を拒否する', () => {
  for (const input of ['0', '-1', 'abc', '1.5', '2 3', String(Number.MAX_SAFE_INTEGER)]) {
    const result = rollDice(input);
    assert.equal(result.ok, false, input);
    assert.match(result.error, /面数|使用方法/u, input);
  }
});
