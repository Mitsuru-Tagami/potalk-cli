import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardKeyPath, cardPath, loadCardManager, newCardNonce, normalizeSocialId, normalizeTipId, verifyCardChallenge, verifyCardResponse } from '../lib/card.mjs';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-card-test-')); process.env.XDG_CONFIG_HOME = dir; });
beforeEach(() => { fs.rmSync(cardPath(), { force: true }); fs.rmSync(cardKeyPath(), { force: true }); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const npub = 'npub1' + 'a'.repeat(58);
const sampleNostrProof = () => ({
  id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128),
  kind: 30078, created_at: 123, tags: [['d', 'potalk-card']], content: 'potalk1-fingerprint'
});

test('本番仕様の名刺を保存して送る：本文署名は付けず、鍵を別ファイルに保護する', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: 'こんにちは', socials: { x: 'tagami_1', github: 'Mitsuru-Tagami' }, tip: { p: 'kofi', id: 'potalk' } });
  const response = manager.response();
  assert.equal(response.k, 'res');
  assert.equal(response.bio, 'こんにちは');
  assert.match(response.ck, /^[A-Za-z0-9_-]{87}$/);
  assert.equal('pr' in response, false);
  assert.equal((await verifyCardResponse(response)).bio, 'こんにちは');
  assert.notEqual(cardKeyPath(), cardPath());
  assert.equal(fs.statSync(cardKeyPath()).mode & 0o777, 0o600);
  assert.equal(fs.statSync(cardPath()).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(cardPath(), 'utf8').includes('"pr"'), false);
  await manager.update({ bio: '更新後' });
  const updated = await verifyCardResponse(manager.response());
  assert.equal(updated.bio, '更新後');
  assert.equal(updated.socials.github, 'Mitsuru-Tagami');
});

test('本番のSNS proof object付きresを受け、本人確認済みとは扱わない', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: 'プロフィール', socials: { x: 'tagami_1', github: 'Mitsuru-Tagami', nostr: npub } });
  const response = {
    ...manager.response(),
    pr: { x: '1234567890', github: 1, nostr: sampleNostrProof() },
    socials: { x: 'tagami_1', github: 'Mitsuru-Tagami', nostr: npub, instagram: 'tagami.photo', youtube: '@日本語abc' },
    tip: { p: 'amazon', id: 'ABCDEFGHIJ' }
  };
  const card = await verifyCardResponse(response);
  assert.equal(card.bio, 'プロフィール');
  assert.equal(card.pr.github, 1);
  assert.equal(card.pr.x, '1234567890');
  assert.equal(card.pr.nostr.kind, 30078);
  assert.equal(card.socials.instagram, 'tagami.photo');
  assert.equal(card.socials.youtube, '@日本語abc');
  assert.deepEqual(card.tip, { p: 'amazon', id: 'ABCDEFGHIJ' });
  assert.equal(card.keyVerified, undefined);
  assert.equal(card.verified, undefined);
});

test('prが旧形式の文字列や不正形でもprだけを捨て、有効なカード本文は残す', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: '表示するカード' });
  const base = manager.response();
  const oldStringProof = await verifyCardResponse({ ...base, pr: 'old-body-signature' });
  assert.equal(oldStringProof.bio, '表示するカード');
  assert.equal(oldStringProof.pr, undefined);
  const badObjectProof = await verifyCardResponse({ ...base, pr: { x: 'not-a-post-id', github: true, nostr: { nope: true } } });
  assert.equal(badObjectProof.bio, '表示するカード');
  assert.equal(badObjectProof.pr, undefined);
  const selfClaim = await verifyCardResponse({ k: 'res', bio: '自己申告', verified: { x: true } });
  assert.equal(selfClaim.bio, '自己申告');
  assert.equal(selfClaim.verified, undefined);
  assert.equal(selfClaim.keyVerified, undefined);
});

test('不正なSNS ID・tip・外部avatar URLは各フィールドだけを落とす', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: '残す本文' });
  const raw = {
    ...manager.response(),
    socials: { x: 'https://evil.example/user', instagram: 'valid.name', youtube: '@日本語abc' },
    tip: { p: 'kampa', id: 'retired' },
    avatar: 'https://example.com/avatar.png'
  };
  const card = await verifyCardResponse(raw);
  assert.equal(card.bio, '残す本文');
  assert.deepEqual(card.socials, { instagram: 'valid.name', youtube: '@日本語abc' });
  assert.equal(card.tip, undefined);
  assert.equal(card.avatar, undefined);
  const prototypeKeys = await verifyCardResponse({
    k: 'res', bio: '安全に残す',
    socials: JSON.parse('{"__proto__":"evil","x":"tagami_1"}'),
    tip: JSON.parse('{"p":"__proto__","id":"evil"}')
  });
  assert.equal(prototypeKeys.bio, '安全に残す');
  assert.deepEqual(prototypeKeys.socials, { x: 'tagami_1' });
  assert.equal(prototypeKeys.tip, undefined);
});

test('アイコンはPNG/WebP/JPEG data URLで128×128以内の画像だけを保持する', async () => {
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
  const sanitized = await verifyCardResponse({ ...manager.response(), bio: '残る', avatar: tooLarge });
  assert.equal(sanitized.bio, '残る');
  assert.equal(sanitized.avatar, undefined);
  assert.deepEqual(await verifyCardResponse({ k: 'res' }), { empty: true });
});

test('旧ローカルの本文署名は正しい場合だけ移行し、ネットワーク応答からは署名を外す', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: '旧名刺', socials: { x: 'tagami_1' } });
  const current = manager.response();
  const storedKey = JSON.parse(fs.readFileSync(cardKeyPath(), 'utf8'));
  const privateKey = await crypto.subtle.importKey('pkcs8', Buffer.from(storedKey.sk, 'base64url'),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const oldFields = { bio: '旧名刺', socials: { x: 'tagami_1' } };
  const oldMessage = 'potalk-card-profile\n1\n' + JSON.stringify(oldFields);
  const oldSignature = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(oldMessage))).toString('base64url');
  fs.writeFileSync(cardPath(), JSON.stringify({ k: 'res', ...oldFields, ck: current.ck, pr: oldSignature }));
  const migrated = await loadCardManager();
  assert.equal(migrated.invalidCard, false);
  assert.equal(migrated.card.bio, '旧名刺');
  assert.equal(migrated.response().pr, undefined);

  fs.writeFileSync(cardPath(), JSON.stringify({ k: 'res', ...oldFields, ck: current.ck, pr: oldSignature, bio: '改ざん' }));
  const invalidLegacy = await loadCardManager();
  assert.equal(invalidLegacy.invalidCard, true);
  assert.deepEqual(invalidLegacy.response(), { k: 'res' });
});

test('本番IDスキーマとURLからSNS・tip IDを正規化し、廃止kampaは拒否する', () => {
  assert.equal(normalizeSocialId('x', 'https://x.com/tagami_2/status/123'), 'tagami_2');
  assert.equal(normalizeSocialId('github', 'https://github.com/Mitsuru-Tagami'), 'Mitsuru-Tagami');
  assert.equal(normalizeSocialId('instagram', 'https://www.instagram.com/name.photo/'), 'name.photo');
  assert.equal(normalizeSocialId('youtube', 'https://www.youtube.com/@日本語abc'), '@日本語abc');
  assert.equal(normalizeSocialId('youtube', 'UC' + 'A'.repeat(22)), 'UC' + 'A'.repeat(22));
  assert.equal(normalizeSocialId('nostr', `nostr:${npub}`), npub);
  assert.equal(normalizeTipId('ofuse', 'https://ofuse.me/users/tagami'), 'tagami');
  assert.equal(normalizeTipId('amazon', 'https://www.amazon.co.jp/hz/wishlist/ls/ABCDEFGHIJ'), 'ABCDEFGHIJ');
  assert.equal(normalizeTipId('zap', `lightning:alice@example.jp`), 'alice@example.jp');
  assert.equal(normalizeTipId('zap', npub), npub);
  assert.equal(normalizeTipId('zap', `https://njump.me/${npub}`), npub);
  assert.equal(normalizeTipId('kofi', 'https://ko-fi.com/potalk'), 'potalk');
  assert.equal(normalizeTipId('bmac', 'potalk'), 'potalk');
  assert.equal(normalizeTipId('kampa', 'potalk'), null);
});

test('challenge応答はroomId・両peerId・nonceに結び付き、受信側は最大64文字のbase64url nonceに応答する', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: 'challenge' });
  const nonce = newCardNonce();
  const response = await manager.answerChallenge('room-1', 'requester', 'owner', nonce);
  const ck = manager.response().ck;
  assert.equal(await verifyCardChallenge('room-1', 'requester', 'owner', nonce, response, ck), true);
  assert.equal(await verifyCardChallenge('room-2', 'requester', 'owner', nonce, response, ck), false);
  assert.equal(await verifyCardChallenge('room-1', 'other', 'owner', nonce, response, ck), false);
  assert.equal(await verifyCardChallenge('room-1', 'requester', 'other', nonce, response, ck), false);
  assert.equal(await verifyCardChallenge('room-1', 'requester', 'owner', newCardNonce(), response, ck), false);
  const longNonce = 'A'.repeat(64);
  assert.equal((await manager.answerChallenge('room-1', 'requester', 'owner', longNonce)).n, longNonce);
  assert.equal(await manager.answerChallenge('room-1', 'requester', 'owner', 'bad nonce'), null);
});

test('不正なaction形式は拒否し、ckのない有効な名刺は未検証の内容として受け取れる', async () => {
  assert.equal(await verifyCardResponse({ k: 'req', bio: 'wrong action' }), null);
  const unkeyed = await verifyCardResponse({ k: 'res', bio: '自己申告のみ', socials: { x: 'tagami_1' } });
  assert.equal(unkeyed.bio, '自己申告のみ');
  assert.equal(unkeyed.ck, undefined);
  assert.equal(unkeyed.keyVerified, undefined);
});
