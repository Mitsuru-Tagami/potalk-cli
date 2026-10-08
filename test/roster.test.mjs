// 配信部屋の名簿の検証（lib/roster.mjs）。本物と同じ形で鍵を作って署名し、通るもの・弾くものを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoster, rosterMsg, fpOf } from '../lib/roster.mjs';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const b64u = buf => Buffer.from(buf).toString('base64url');

async function owner() {
  const kp = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const roomId = 'abcdEFGH1234_-xy~pk~' + await fpOf(pub);
  const sign = async (id, t, own, ids) => ({
    pk: pub, t, o: own, ids,
    sig: b64u(await crypto.subtle.sign(SIGN_ALG, kp.privateKey, new TextEncoder().encode(rosterMsg(id, t, own, ids))))
  });
  return { pub, roomId, sign };
}

test('正しい名簿は通る（配信者と話してよい人が分かる）', async () => {
  const o = await owner();
  const r = await verifyRoster(o.roomId, await o.sign(o.roomId, 100, 'OWNER', ['OWNER', 'GUEST']));
  assert.deepEqual({ t: r.t, own: r.own, ids: r.ids }, { t: 100, own: 'OWNER', ids: ['OWNER', 'GUEST'] });
});

test('採用済みより古い（同じ時刻も）名簿は弾く＝使い回しが効かない', async () => {
  const o = await owner();
  const d = await o.sign(o.roomId, 100, 'OWNER', ['OWNER']);
  assert.equal(await verifyRoster(o.roomId, d, 100), null);
  assert.equal(await verifyRoster(o.roomId, d, 150), null);
});

test('別の部屋のために署名された名簿は弾く', async () => {
  const o = await owner();
  const other = o.roomId.replace('abcdEFGH', 'zzzzzzzz');
  assert.equal(await verifyRoster(o.roomId, await o.sign(other, 100, 'OWNER', ['OWNER'])), null);
});

test('署名のあとで中身（話してよい人）を書き換えた名簿は弾く', async () => {
  const o = await owner();
  const d = await o.sign(o.roomId, 100, 'OWNER', ['OWNER']);
  assert.equal(await verifyRoster(o.roomId, { ...d, ids: ['OWNER', 'INTRUDER'] }), null);
  assert.equal(await verifyRoster(o.roomId, { ...d, o: 'INTRUDER' }), null);
});

test('部屋の指紋と合わない鍵（自称の配信者）は、署名が正しくても弾く', async () => {
  const real = await owner(), fake = await owner();
  // 偽者が自分の鍵で、本物の部屋 ID に対して正しく署名しても通らない
  assert.equal(await verifyRoster(real.roomId, await fake.sign(real.roomId, 100, 'FAKE', ['FAKE'])), null);
});

test('配信部屋でない（指紋の無い）部屋や、形の崩れた名簿は弾く', async () => {
  const o = await owner();
  const d = await o.sign(o.roomId, 100, 'OWNER', ['OWNER']);
  assert.equal(await verifyRoster('abcdEFGH1234_-xy', d), null);
  assert.equal(await verifyRoster(o.roomId, { ...d, t: '100' }), null);
  assert.equal(await verifyRoster(o.roomId, { ...d, sig: 'short' }), null);
  assert.equal(await verifyRoster(o.roomId, null), null);
});
