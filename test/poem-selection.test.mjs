import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MAX } from '../lib/config.mjs';
import {
  pickRandomPoem,
  poemDataCounts,
  selectRandomHaiku,
  selectRandomWaka
} from '../lib/poems.mjs';

test('pickRandomPoem は乱数関数に [0, 件数) を渡し、選ばれた要素だけを返す', () => {
  const entries = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
  const calls = [];
  const selected = pickRandomPoem(entries, (min, max) => {
    calls.push([min, max]);
    return max - 1;
  });
  assert.equal(selected, entries[2]);
  assert.deepEqual(calls, [[0, 3]]);
  assert.deepEqual(entries, [{ text: 'a' }, { text: 'b' }, { text: 'c' }], 'selection does not mutate its input');
});

test('pickRandomPoem は空・不正な範囲を安全に処理する', () => {
  let called = false;
  assert.equal(pickRandomPoem([], () => { called = true; return 0; }), null);
  assert.equal(called, false);
  assert.equal(pickRandomPoem(null), null);
  assert.equal(pickRandomPoem([{ text: 'a' }], () => -1), null);
  assert.equal(pickRandomPoem([{ text: 'a' }], () => 1), null);
});

test('ローカルデータから乱数で選んだ句は作者・出典付きの60文字以内の一行', () => {
  const counts = poemDataCounts();
  assert.ok(counts.waka > 0);
  assert.ok(counts.haiku > 0);
  for (const [message, source] of [
    [selectRandomWaka((min, max) => min), '〔古今集・国文研〕'],
    [selectRandomHaiku((min, max) => max - 1), '〔松山市・子規俳句〕']
  ]) {
    assert.ok(message.endsWith(source), message);
    assert.match(message, / — .+〔/u);
    assert.equal(/[\r\n\u2028\u2029]/u.test(message), false);
    assert.ok([...message].length <= CHAT_MAX, message);
  }
});
