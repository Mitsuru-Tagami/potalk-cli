import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardKeyPath, cardPath, loadCardManager, newCardNonce, verifyCardChallenge, verifyCardResponse } from '../lib/card.mjs';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-card-test-')); process.env.XDG_CONFIG_HOME = dir; });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('カードは分離したP-256秘密鍵で署名され、正しい公開鍵でのみ検証できる', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: 'こんにちは', socials: { x: 'tagami_1', github: 'Mitsuru-Tagami' }, tip: { p: 'kofi', id: 'potalk' } });
  const response = manager.response();
  assert.equal(response.k, 'res');
  assert.equal(response.bio, 'こんにちは');
  assert.equal((await verifyCardResponse(response)).bio, 'こんにちは');
  assert.notEqual(cardKeyPath(), cardPath());
  assert.equal(fs.statSync(cardKeyPath()).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(cardPath(), 'utf8').includes(response.pr), true);
  assert.equal(fs.readFileSync(cardPath(), 'utf8').includes(response.ck), true);
  await manager.update({ bio: '更新後' });
  const partial = await verifyCardResponse(manager.response());
  assert.equal(partial.bio, '更新後');
  assert.equal(partial.socials.github, 'Mitsuru-Tagami');
});

test('カードJSONだけを直接書き換えると読込時に署名不一致として破棄する', async () => {
  const original = JSON.parse(fs.readFileSync(cardPath(), 'utf8'));
  const tampered = { ...original, bio: '改ざんされた内容' };
  fs.writeFileSync(cardPath(), JSON.stringify(tampered));
  const manager = await loadCardManager();
  assert.equal(manager.invalidCard, true);
  assert.deepEqual(manager.response(), { k: 'res' });
  await manager.update({ bio: '入力し直した内容' });
  assert.equal((await verifyCardResponse(manager.response())).bio, '入力し直した内容');
});

test('アイコンはPNG/WebP/JPEG data URLで128×128以内の画像だけを通す', async () => {
  const manager = await loadCardManager();
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  Buffer.from('IHDR').copy(png, 12);
  png.writeUInt32BE(128, 16);
  png.writeUInt32BE(128, 20);
  const avatar = `data:image/png;base64,${png.toString('base64')}`;
  await manager.update({ avatar });
  assert.equal((await verifyCardResponse(manager.response())).avatar, avatar);
  png.writeUInt32BE(129, 16);
  const tooLarge = `data:image/png;base64,${png.toString('base64')}`;
  assert.equal(await verifyCardResponse({ ...manager.response(), avatar: tooLarge }), null);
});

test('受信カードの署名後の改変、不正ID、URL送信、過大画像を拒否する', async () => {
  const manager = await loadCardManager();
  const signed = manager.response();
  assert.equal((await verifyCardResponse(signed)).bio, '入力し直した内容');
  assert.equal(await verifyCardResponse({ ...signed, bio: '改ざん' }), null);
  assert.equal(await verifyCardResponse({ ...signed, socials: { ...signed.socials, x: 'https://evil.example' } }), null);
  assert.equal(await verifyCardResponse({ ...signed, avatar: 'https://example.com/a.png' }), null);
  assert.equal(await verifyCardResponse({ ...signed, avatar: `data:image/png;base64,${'A'.repeat(40001)}` }), null);
  assert.deepEqual(await verifyCardResponse({ k: 'res' }), { empty: true });
});

test('challenge応答はroomId・両peerId・nonceすべてを束縛する', async () => {
  const manager = await loadCardManager();
  const nonce = newCardNonce();
  const response = await manager.answerChallenge('room-1', 'requester', 'owner', nonce);
  const ck = manager.response().ck;
  assert.equal(await verifyCardChallenge('room-1', 'requester', 'owner', nonce, response, ck), true);
  assert.equal(await verifyCardChallenge('room-2', 'requester', 'owner', nonce, response, ck), false);
  assert.equal(await verifyCardChallenge('room-1', 'other', 'owner', nonce, response, ck), false);
  assert.equal(await verifyCardChallenge('room-1', 'requester', 'other', nonce, response, ck), false);
  assert.equal(await verifyCardChallenge('room-1', 'requester', 'owner', newCardNonce(), response, ck), false);
});

test('不正な署名形式や空の署名フィールドを持つ応答は通さない', async () => {
  const manager = await loadCardManager();
  const response = manager.response();
  assert.equal(await verifyCardResponse({ k: 'res', ...response, pr: 'bad' }), null);
  assert.equal(await verifyCardResponse({ ...response, k: 'req' }), null);
  assert.equal(await verifyCardResponse({ k: 'res', bio: 'unsigned' }), null);
});
