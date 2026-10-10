// 配信部屋の配信者本人確認（oath）。公開鍵は verifyRoster 済みのものだけを渡すこと。
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const NONCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const B64U_RE = /^[A-Za-z0-9_-]{80,100}$/;
const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = value => new Uint8Array(Buffer.from(value, 'base64url'));
const enc = value => new TextEncoder().encode(value);

export const authMsg = (roomId, nonce) => 'auth\n' + roomId + '\n' + nonce;

// 16 bytes become a 22-character unpadded base64url nonce.
export const newOathNonce = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

/**
 * Verify an oath response against the pending nonce and the public key from an accepted roster.
 * The roster's pk must already have passed the room fingerprint and roster signature checks.
 */
export async function verifyOathResponse(roomId, nonce, response, publicKey) {
  if (typeof roomId !== 'string' || !roomId || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return false;
  if (!response || typeof response !== 'object' || response.k !== 'a' || response.n !== nonce) return false;
  if (typeof response.sig !== 'string' || !B64U_RE.test(response.sig)) return false;
  if (typeof publicKey !== 'string' || !B64U_RE.test(publicKey)) return false;
  const key = await crypto.subtle.importKey('raw', unb64u(publicKey), ECDSA, false, ['verify']).catch(() => null);
  if (!key) return false;
  return crypto.subtle.verify(SIGN_ALG, key, unb64u(response.sig), enc(authMsg(roomId, nonce))).catch(() => false);
}
