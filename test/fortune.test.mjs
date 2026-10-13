import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MAX } from '../lib/config.mjs';
import { CONSTELLATIONS, createHoroscopeResult, createOmikujiResult, createSeizaResult, ZODIAC_SIGNS } from '../lib/fortune.mjs';

const assertChatMessage = message => {
  assert.equal(/[\r\n\u2028\u2029]/u.test(message), false, message);
  assert.ok([...message].length <= CHAT_MAX, `${[...message].length} > ${CHAT_MAX}: ${message}`);
};

test('createSeizaResult: 星座未指定なら88星座から一つ選び、説明を返す', () => {
  const calls = [];
  const result = createSeizaResult('', {
    randomIntImpl: (min, max) => { calls.push([min, max]); return max - 1; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.constellation, CONSTELLATIONS.at(-1));
  assert.match(result.message, /^わし座：.+$/u);
  assert.deepEqual(calls, [[0, 88]]);
  assertChatMessage(result.message);
});

test('createSeizaResult: 日本語名・座の省略・別名・ラテン名・略符で指定できる', () => {
  for (const [input, expected] of [
    ['オリオン座', 'オリオン座'], ['オリオン', 'オリオン座'],
    ['牡羊座', 'おひつじ座'], ['Orion', 'オリオン座'], ['Ori', 'オリオン座']
  ]) {
    let called = false;
    const result = createSeizaResult(input, { randomIntImpl: () => { called = true; return 0; } });
    assert.equal(result.ok, true, input);
    assert.equal(result.name, expected, input);
    assert.equal(called, false, 'a specified constellation must not draw randomly');
    assertChatMessage(result.message);
  }
});

test('createSeizaResult: 88個の一意な星座すべてに一行・60文字以内の解説がある', () => {
  assert.equal(CONSTELLATIONS.length, 88);
  assert.equal(new Set(CONSTELLATIONS.map(item => item.name)).size, 88);
  assert.equal(new Set(CONSTELLATIONS.map(item => item.latin)).size, 88);
  assert.equal(new Set(CONSTELLATIONS.map(item => item.abbr)).size, 88);
  for (const constellation of CONSTELLATIONS) {
    assert.ok(constellation.description, constellation.name);
    assert.ok(constellation.name.endsWith('座'), constellation.name);
    const result = createSeizaResult(constellation.name, { randomIntImpl: () => { throw new Error('unexpected random draw'); } });
    assert.equal(result.ok, true, constellation.name);
    assert.equal(result.name, constellation.name);
    assert.equal(result.description, constellation.description);
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
  assert.equal(createSeizaResult('', { randomIntImpl: () => 88 }).ok, false);
});

test('createHoroscopeResult: 星座未指定なら12星座から選び、ひとことを添える', () => {
  const calls = [];
  const result = createHoroscopeResult('', {
    randomIntImpl: (min, max) => { calls.push([min, max]); return max - 1; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.sign, '魚座');
  assert.match(result.message, /^魚座の占い：.+$/u);
  assert.deepEqual(calls, [[0, 12], [0, 3]]);
  assertChatMessage(result.message);
});

test('createHoroscopeResult: 12星座すべてを指定でき、短縮名も受け付ける', () => {
  assert.equal(ZODIAC_SIGNS.length, 12);
  for (const sign of ZODIAC_SIGNS) {
    const result = createHoroscopeResult(sign, { randomIntImpl: () => 0 });
    assert.equal(result.ok, true, sign);
    assert.equal(result.sign, sign);
    assert.match(result.message, new RegExp(`^${sign}の占い：`, 'u'));
    assertChatMessage(result.message);
  }
  assert.equal(createHoroscopeResult('牡牛', { randomIntImpl: () => 0 }).sign, '牡牛座');
});

test('createHoroscopeResult: 不明な星座を拒否し、不正な乱数結果を安全に扱う', () => {
  let called = false;
  const invalid = createHoroscopeResult('どらごん座', { randomIntImpl: () => { called = true; return 0; } });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /使用方法/u);
  assert.equal(called, false);
  assert.equal(createHoroscopeResult('', { randomIntImpl: () => -1 }).ok, false);
  assert.equal(createHoroscopeResult('牡羊座', { randomIntImpl: () => 3 }).ok, false);
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
