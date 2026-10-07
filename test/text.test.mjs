import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capText, strWidth, padWidth, tuiText } from '../lib/text.mjs';

test('capText：見えない制御文字・書字方向の文字を消す', () => {
  assert.equal(capText('a\u202Eb\u200Fc\u2066d\u0007e\u061Cf', 60), 'abcdef');
});

test('capText：コードポイント単位で切り詰める（絵文字を半分にしない）', () => {
  assert.equal(capText('🦉'.repeat(30), 20), '🦉'.repeat(20));
  assert.equal([...capText('あ'.repeat(70), 60)].length, 60);
  assert.equal(capText(undefined, 8, '🙂'), '🙂');
});

test('strWidth：全角と「絵文字として出る文字」は 2、半角と文字表示の記号は 1', () => {
  assert.equal(strWidth('あア漢'), 6);
  assert.equal(strWidth('ｸﾗﾓ'), 3);
  assert.equal(strWidth('👋🦉☕⭐'), 8);
  assert.equal(strWidth('🖥⌨'), 2);
});

test('padWidth：表示幅でそろえ、はみ出す分は切る', () => {
  assert.equal(padWidth('🦉qramo', 10), '🦉qramo   ');
  assert.equal(padWidth('あいうえお', 5), 'あい ');
});

test('tuiText：U+FE0F を外す', () => {
  assert.equal(tuiText('⌨️qramo'), '⌨qramo');
});
