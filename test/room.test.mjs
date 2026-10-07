import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomRef, isRoomRef, capRoomId, isBcRoom, newRoomId, roomUrl } from '../lib/room.mjs';

const FP = 'A'.repeat(22);   // 配信部屋の指紋（22 文字）

test('parseRoomRef：招待リンクから部屋 ID と名前を取り出す', () => {
  assert.deepEqual(parseRoomRef('https://potalk.app/#room=abcdEFGH1234_-xy&name=%E3%83%86%E3%82%B9%E3%83%88'),
    { roomId: 'abcdEFGH1234_-xy', name: 'テスト' });
  assert.deepEqual(parseRoomRef('abcdEFGH1234_-xy'), { roomId: 'abcdEFGH1234_-xy', name: '' });
});

test('isRoomRef：リンク・16 文字のハッシュ・配信部屋は ID、それ以外は名前の一部', () => {
  assert.ok(isRoomRef('https://potalk.app/#room=abc&name=x'));
  assert.ok(isRoomRef('abcdEFGH1234_-xy'));
  assert.ok(isRoomRef('abcdEFGH1234_-xy~pk~' + FP));
  assert.ok(!isRoomRef('アサ'));
  assert.ok(!isRoomRef('ぽっと通話にようこそ'));
});

test('capRoomId：切り詰めるのは名前の部分だけ（配信部屋の指紋は残す）', () => {
  const long = 'あ'.repeat(40) + '~pk~' + FP;
  const id = capRoomId(long);
  assert.ok(id.endsWith('~pk~' + FP));
  assert.ok(isBcRoom(id));
  assert.equal([...id.split('~pk~')[0]].length, 30);
});

test('newRoomId：本家と同じ 16 文字の base64url', () => {
  assert.match(newRoomId(), /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(newRoomId(), newRoomId());
});

test('roomUrl：potalk.app の招待リンクを組み立てる', () => {
  assert.equal(roomUrl('abc', 'テスト'), 'https://potalk.app/#room=abc&name=%E3%83%86%E3%82%B9%E3%83%88');
  assert.equal(roomUrl('abc', ''), 'https://potalk.app/#room=abc');
});
