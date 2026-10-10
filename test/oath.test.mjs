import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authMsg, newOathNonce, verifyOathResponse } from '../lib/oath.mjs';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const b64u = value => Buffer.from(value).toString('base64url');

async function identity() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  return {
    publicKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)),
    sign: async (roomId, nonce) => ({
      k: 'a', n: nonce,
      sig: b64u(await crypto.subtle.sign(SIGN_ALG, pair.privateKey, new TextEncoder().encode(authMsg(roomId, nonce))))
    })
  };
}

test('nonce は新しい 16 バイト乱数の base64url（22 文字）', () => {
  const a = newOathNonce(), b = newOathNonce();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(Buffer.from(a, 'base64url').length, 16);
  assert.notEqual(a, b);
});

test('正しい roomId・未処理 nonce・名簿公開鍵による oath 応答だけを通す', async () => {
  const owner = await identity();
  const roomId = 'abcdEFGH1234_-xy~pk~fingerprint';
  const nonce = newOathNonce();
  assert.equal(await verifyOathResponse(roomId, nonce, await owner.sign(roomId, nonce), owner.publicKey), true);
});

test('別の nonce／部屋／公開鍵で作られた応答は通さない', async () => {
  const owner = await identity(), other = await identity();
  const roomId = 'abcdEFGH1234_-xy~pk~fingerprint';
  const nonce = newOathNonce();
  const response = await owner.sign(roomId, nonce);
  assert.equal(await verifyOathResponse(roomId, newOathNonce(), response, owner.publicKey), false);
  assert.equal(await verifyOathResponse('another-room', nonce, response, owner.publicKey), false);
  assert.equal(await verifyOathResponse(roomId, nonce, response, other.publicKey), false);
  assert.equal(await verifyOathResponse(roomId, nonce, { ...response, sig: response.sig.slice(0, -1) + (response.sig.endsWith('A') ? 'B' : 'A') }, owner.publicKey), false);
});

test('不正形式・別種の oath メッセージを拒否する', async () => {
  const owner = await identity();
  const roomId = 'abcdEFGH1234_-xy~pk~fingerprint';
  const nonce = newOathNonce();
  assert.equal(await verifyOathResponse(roomId, nonce, { k: 'q', n: nonce }, owner.publicKey), false);
  assert.equal(await verifyOathResponse(roomId, nonce, { k: 'a', n: 'bad', sig: 'x' }, owner.publicKey), false);
  assert.equal(await verifyOathResponse(roomId, nonce, { k: 'a', n: nonce, sig: 'short' }, owner.publicKey), false);
  assert.equal(await verifyOathResponse(roomId, nonce, { k: 'a', n: nonce, sig: 'A'.repeat(86) }, 'bad'), false);
});
