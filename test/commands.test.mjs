import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeRoomCommand, commonCommandPrefix, roomCommandMatches, setPackCommands } from '../lib/commands.mjs';
import { copyRoomUrl } from '../lib/clipboard.mjs';

test('roomCommandMatches：内蔵コマンドを接頭辞で補完し、パックのコマンドは有効化された分だけ加わる', () => {
  setPackCommands([]);
  assert.deepEqual(roomCommandMatches('/c'), ['/card', '/cp', '/copy']);
  assert.deepEqual(roomCommandMatches('/d'), []);
  assert.deepEqual(roomCommandMatches('/wa'), []);
  assert.deepEqual(roomCommandMatches('/co'), ['/copy']);
  setPackCommands(['/dice', '/waka', '/haiku', '/seiza', '/uranai', '/omikuji']);
  assert.deepEqual(roomCommandMatches('/d'), ['/dice']);
  assert.deepEqual(roomCommandMatches('/wa'), ['/waka']);
  assert.deepEqual(roomCommandMatches('/hai'), ['/haiku']);
  assert.deepEqual(roomCommandMatches('/sei'), ['/seiza']);
  assert.deepEqual(roomCommandMatches('/uran'), ['/uranai']);
  assert.deepEqual(roomCommandMatches('/omi'), ['/omikuji']);
  assert.deepEqual(completeRoomCommand('/dice'), [['/dice'], '/dice']);
  assert.deepEqual(roomCommandMatches('/di'), ['/dice']);
  assert.deepEqual(roomCommandMatches('/hb'), ['/hbk']);
  assert.deepEqual(roomCommandMatches('/unh'), ['/unhbk']);
  assert.ok(roomCommandMatches('/').includes('/help'));
  setPackCommands([]);
});

test('roomCommandMatches：コマンド以外と引数入力中は補完しない', () => {
  assert.deepEqual(roomCommandMatches('hello'), []);
  assert.deepEqual(roomCommandMatches('/tag 話題'), []);
  assert.deepEqual(roomCommandMatches('/not-a-command'), []);
});

test('completeRoomCommand：readline completer の形式を返す', () => {
  assert.deepEqual(completeRoomCommand('/mic'), [['/mic'], '/mic']);
});

test('commonCommandPrefix：複数候補の共通部分を返す', () => {
  assert.equal(commonCommandPrefix(['/cp', '/copy']), '/c');
  assert.equal(commonCommandPrefix([]), '');
});

test('copyRoomUrl：URLだけをコピーし、成功を通知する', async () => {
  const written = [], messages = [];
  const ok = await copyRoomUrl('https://potalk.app/#room=abc&name=room', {
    write: async value => written.push(value),
    onText: message => messages.push(message)
  });
  assert.equal(ok, true);
  assert.deepEqual(written, ['https://potalk.app/#room=abc&name=room']);
  assert.match(messages[0], /クリップボードに部屋のURLをコピーしました/);
});

test('copyRoomUrl：コピーに失敗したときも例外を投げずに通知する', async () => {
  const messages = [];
  const ok = await copyRoomUrl('https://potalk.app/#room=abc', {
    write: async () => { throw new Error('clipboard unavailable'); },
    onText: message => messages.push(message)
  });
  assert.equal(ok, false);
  assert.match(messages[0], /コピーできませんでした/);
});
