import { test } from 'node:test';
import assert from 'node:assert/strict';
import blessed from 'blessed';
import { fixBlessedWidths } from '../lib/tui.mjs';

test('fixBlessedWidths：絵文字を 2 マス、文字表示の記号と半角は 1 マスと数えさせる', () => {
  fixBlessedWidths();
  const u = blessed.unicode;
  assert.equal(u.charWidth('👋', 0), 2);
  assert.equal(u.charWidth('☕', 0), 2);
  assert.equal(u.charWidth('あ', 0), 2);
  assert.equal(u.charWidth('a', 0), 1);
  assert.equal(u.charWidth('⌨', 0), 1);
  // 2 マスの文字の後ろに詰め物が入る（blessed の element.js が使う）
  assert.equal('a👋b☕c'.replace(u.chars.all, '$1\x03'), 'a👋\x03b☕\x03c');
});
