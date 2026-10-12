import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardKeyPath, cardPath, loadCardManager } from '../lib/card.mjs';
import { editCardInteractive } from '../commands/card-edit.mjs';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-card-edit-test-')); process.env.XDG_CONFIG_HOME = dir; });
beforeEach(() => { fs.rmSync(cardPath(), { force: true }); fs.rmSync(cardKeyPath(), { force: true }); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const responder = values => async () => values.shift() ?? '';
const blankFields = () => ['', '', '', '', '', '', '', '', ''];

test('空Enterは値を維持し、削除記号は指定した項目だけを削除する', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: 'old bio', socials: { x: 'old_x', github: 'old-user' } });
  const before = manager.response();
  assert.equal(await editCardInteractive(manager, responder(blankFields())), true);
  assert.deepEqual(manager.response(), before);
  assert.equal(await editCardInteractive(manager, responder(['-', '-', '', '', '', '', '', '', ''])), true);
  const after = manager.response();
  assert.equal('bio' in after, false);
  assert.equal('x' in (after.socials || {}), false);
  assert.equal(after.socials.github, 'old-user');
});

test('不正SNS IDは再質問し、正しいIDだけを保存する', async () => {
  const manager = await loadCardManager();
  const messages = [];
  assert.equal(await editCardInteractive(manager, responder(['', 'bad/url', 'tagami_2', '', '', '', '', '', '']), message => messages.push(message)), true);
  assert.ok(messages.some(message => message.includes('入力形式が正しくありません')));
  assert.equal(manager.card.socials.x, 'tagami_2');
  assert.equal(manager.response().pr, undefined);
  assert.ok(messages.some(message => message.includes('SNS本人確認は行わず')));
});

test('本番対応のInstagram・YouTube URLとAmazonほしい物リストURLをID化して保存する', async () => {
  const manager = await loadCardManager();
  const npub = 'npub1' + 'a'.repeat(58);
  const values = [
    'プロフィール', '', '', '', 'https://www.instagram.com/name.photo/',
    'https://www.youtube.com/@日本語abc', npub,
    'amazon:https://www.amazon.co.jp/hz/wishlist/ls/ABCDEFGHIJ', ''
  ];
  assert.equal(await editCardInteractive(manager, responder(values)), true);
  assert.deepEqual(manager.card.socials, { instagram: 'name.photo', youtube: '@日本語abc', nostr: npub });
  assert.deepEqual(manager.card.tip, { p: 'amazon', id: 'ABCDEFGHIJ' });
});
