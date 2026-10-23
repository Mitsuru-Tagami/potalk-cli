import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capText, strWidth, padWidth, tuiText } from '../lib/text.mjs';

test('capText：見えない制御文字・書字方向の文字を消す', () => {
  assert.equal(capText('a\u202Eb\u200Fc\u2066d\u0007e\u061Cf', 60), 'abcdef');
});

test('capText：見えない文字を消す（本家 PROTOCOL §7・v0.16.3 と一致）', () => {
  // ゼロ幅スペース・ZWNJ・ソフトハイフン・結合用書記素ジョイナ・ハングルの埋め文字・
  // モンゴル母音区切り・語結合子と見えない演算子・行／段落区切り・BOM
  assert.equal(capText('ja\u200Bck', 60), 'jack');
  assert.equal(capText('a\u200Cb\u00ADc\u034Fd\u115Fe\u1160f\u3164g\uFFA0h', 60), 'abcdefgh');
  assert.equal(capText('a\u180Eb\u2060c\u2064d\u2028e\u2029f\uFEFFg', 60), 'abcdefg');
  // 名前に紛れ込ませても、本家と同じ整形結果になる（見た目が同じ別名を作れない）
  assert.equal(capText('\u200B\u200Bqramo\u200B', 20), 'qramo');
});

test('capText：絵文字の結合に使う文字は消さない（ZWJ・異体字セレクタ）', () => {
  assert.equal(capText('👨\u200D👩\u200D👧', 60), '👨\u200D👩\u200D👧');
  assert.equal(capText('⌨\uFE0F', 60), '⌨\uFE0F');
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
