import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MAX } from '../lib/config.mjs';
import { createOmikujiResult, createSeizaResult, ZODIAC_SIGNS } from '../lib/fortune.mjs';

const assertChatMessage = message => {
  assert.equal(/[\r\n\u2028\u2029]/u.test(message), false, message);
  assert.ok([...message].length <= CHAT_MAX, `${[...message].length} > ${CHAT_MAX}: ${message}`);
};

test('createSeizaResult: 星座未指定なら12星座から一つ選び、一言も同じ乱数境界で選ぶ', () => {
  const calls = [];
  const result = createSeizaResult('', {
    randomIntImpl: (min, max) => {
      calls.push([min, max]);
      return calls.length === 1 ? max - 1 : 0;
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.sign, '魚座');
  assert.match(result.message, /^魚座：/u);
  assert.deepEqual(calls, [[0, 12], [0, 3]]);
  assertChatMessage(result.message);
});

test('createSeizaResult: 星座指定は短縮名も受け付け、一言だけをランダム選択', () => {
  let range;
  const result = createSeizaResult('牡牛', {
    randomIntImpl: (min, max) => { range = [min, max]; return max - 1; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.sign, '牡牛座');
  assert.match(result.message, /^牡牛座：/u);
  assert.deepEqual(range, [0, 3]);
  assertChatMessage(result.message);
});

test('createSeizaResult: 12星座すべての指定が一行・60文字以内で結果になる', () => {
  assert.equal(ZODIAC_SIGNS.length, 12);
  for (const sign of ZODIAC_SIGNS) {
    const result = createSeizaResult(sign, { randomIntImpl: () => 0 });
    assert.equal(result.ok, true, sign);
    assert.equal(result.sign, sign);
    assert.match(result.message, new RegExp(`^${sign}：`, 'u'));
    assertChatMessage(result.message);
  }
});

test('createSeizaResult: 不明な星座を拒否し、乱数選択を行わない', () => {
  let called = false;
  const result = createSeizaResult('どらごん座', { randomIntImpl: () => { called = true; return 0; } });
  assert.equal(result.ok, false);
  assert.match(result.error, /使用方法/u);
  assert.equal(called, false);
});

test('createSeizaResult: 不正な乱数結果を安全に扱う', () => {
  assert.equal(createSeizaResult('', { randomIntImpl: () => -1 }).ok, false);
  assert.equal(createSeizaResult('牡羊座', { randomIntImpl: () => 3 }).ok, false);
});

test('createOmikujiResult: 6種類の運勢を選び、ひとことと今日の提案を添える', () => {
  const fortunes = [];
  for (let index = 0; index < 6; index += 1) {
    const result = createOmikujiResult({ randomIntImpl: (min, max) => {
      assert.deepEqual([min, max], [0, 6]);
      return index;
    } });
    assert.equal(result.ok, true);
    assert.ok(result.message.startsWith(`${result.fortune}｜ひとこと：`), result.message);
    assert.match(result.message, /今日の提案：.+。$/u);
    assertChatMessage(result.message);
    fortunes.push(result.fortune);
  }
  assert.deepEqual(fortunes, ['大吉', '吉', '中吉', '小吉', '末吉', '凶']);
});

test('createOmikujiResult: 不正な乱数結果を安全に扱う', () => {
  const result = createOmikujiResult({ randomIntImpl: () => 6 });
  assert.equal(result.ok, false);
  assert.match(result.error, /選べません/u);
});
