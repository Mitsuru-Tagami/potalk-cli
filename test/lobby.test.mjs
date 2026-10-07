import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoom } from '../lib/lobby.mjs';

const room = { id: 'x', rn: 'アサコの部屋', tag: 'カレー', people: [{ name: 'ゆうり@端末' }] };

test('matchRoom：部屋名・話題タグ・いる人の名前で合う', () => {
  assert.ok(matchRoom(room, 'アサコ'));
  assert.ok(matchRoom(room, 'カレー'));
  assert.ok(matchRoom(room, 'ゆうり'));
  assert.ok(!matchRoom(room, 'なし'));
});

test('matchRoom：ひらがな／カタカナ・全角／半角・大小を区別しない', () => {
  assert.ok(matchRoom(room, 'あさ'));
  assert.ok(matchRoom(room, 'ｱｻ'));
  assert.ok(matchRoom({ ...room, rn: 'ptk テスト中' }, 'PTK'));
  assert.ok(matchRoom({ ...room, rn: 'ptk テスト中' }, 'てすと'));
});

test('matchRoom：空なら全部に合う', () => {
  assert.ok(matchRoom(room, ''));
  assert.ok(matchRoom(room, '  '));
});
