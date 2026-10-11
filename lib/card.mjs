// Signed profile cards for the `card` P2P action.
// The private key is stored separately from the editable card JSON (0600); the
// signature detects direct card-file edits. It proves key possession, not that
// a human's claims are true or that a local administrator cannot use the key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capText } from './text.mjs';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const PUB_RE = /^[A-Za-z0-9_-]{87}$/;
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;
const SOCIAL_RULES = Object.freeze({
  x: /^[A-Za-z0-9_]{1,15}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
  note: /^[A-Za-z0-9_]{3,32}$/,
  nostr: /^npub1[0-9a-z]{58}$/
});
const TIP_PROVIDERS = new Set(['ofuse', 'zap', 'kofi', 'bmac', 'kampa']);
const TIP_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const TIP_ZAP_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
const AVATAR_RE = /^data:image\/(?:webp|jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/;
const textEncoder = new TextEncoder();
const b64u = value => Buffer.from(value).toString('base64url');
const unb64u = value => new Uint8Array(Buffer.from(value, 'base64url'));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function imageDimensions(bytes, mime) {
  if (mime === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (sof.has(marker)) {
        if (length < 7) return null;
        return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
    return null;
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunk = bytes.toString('ascii', offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (size > bytes.length - start) return null;
      if (chunk === 'VP8X' && size >= 10) {
        return { width: 1 + bytes[start + 4] + bytes[start + 5] * 256 + bytes[start + 6] * 65536,
          height: 1 + bytes[start + 7] + bytes[start + 8] * 256 + bytes[start + 9] * 65536 };
      }
      if (chunk === 'VP8 ' && size >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
        return { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
      }
      if (chunk === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
        return { width: 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8),
          height: 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10) };
      }
      offset = start + size + (size % 2);
    }
  }
  return null;
}

const configDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ptk');
export const cardPath = () => path.join(configDir(), 'card.json');
export const cardKeyPath = () => path.join(configDir(), 'card-key.json');

function ensurePrivateDir() {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(configDir(), 0o700); } catch {}
}

function writePrivateJson(file, value) {
  ensurePrivateDir();
  const temp = `${file}.${process.pid}.${b64u(crypto.getRandomValues(new Uint8Array(6)))}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function normalizeCardFields(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const result = {};
  if (own(source, 'bio')) {
    if (typeof source.bio !== 'string' || [...source.bio].length > 60 || capText(source.bio, 60) !== source.bio) return null;
    if (source.bio) result.bio = source.bio;
  }
  if (own(source, 'avatar')) {
    if (typeof source.avatar !== 'string' || source.avatar.length > 40000) return null;
    const match = source.avatar.match(AVATAR_RE);
    if (!match || !match[1]) return null;
    const raw = match[1].replace(/=+$/, '');
    if (raw.length % 4 === 1) return null;
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.toString('base64') !== match[1]) return null;
    const mime = source.avatar.slice(5, source.avatar.indexOf(';'));
    const dimensions = imageDimensions(bytes, mime);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 128 || dimensions.height > 128) return null;
    result.avatar = source.avatar;
  }
  if (own(source, 'socials')) {
    if (!source.socials || typeof source.socials !== 'object' || Array.isArray(source.socials)) return null;
    const socials = {};
    for (const key of Object.keys(SOCIAL_RULES)) {
      if (!own(source.socials, key)) continue;
      const value = source.socials[key];
      if (typeof value !== 'string' || !SOCIAL_RULES[key].test(value)) return null;
      socials[key] = value;
    }
    if (Object.keys(socials).length) result.socials = socials;
  }
  if (own(source, 'tip')) {
    if (!source.tip || typeof source.tip !== 'object' || Array.isArray(source.tip)) return null;
    const { p, id } = source.tip;
    if (!TIP_PROVIDERS.has(p) || typeof id !== 'string' || !(p === 'zap' ? TIP_ZAP_RE : TIP_ID_RE).test(id)) return null;
    result.tip = { p, id };
  }
  return result;
}

// Stable property order and a domain separator prevent signing ambiguity and
// prevent the same signature from being reused as another kind of message.
export function cardProfileMessage(fields) {
  const normalized = normalizeCardFields(fields);
  if (!normalized) throw new TypeError('invalid card fields');
  return 'potalk-card-profile\n1\n' + JSON.stringify(normalized);
}

export function cardChallengeMessage(roomId, requesterPeerId, ownerPeerId, nonce) {
  return `card\n${roomId}\n${requesterPeerId}\n${ownerPeerId}\n${nonce}`;
}

export const newCardNonce = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

async function verifySignature(publicKey, signature, message) {
  if (typeof publicKey !== 'string' || !PUB_RE.test(publicKey) || typeof signature !== 'string' || !SIG_RE.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', unb64u(publicKey), ECDSA, false, ['verify']).catch(() => null);
  if (!key) return false;
  return crypto.subtle.verify(SIGN_ALG, key, unb64u(signature), textEncoder.encode(message)).catch(() => false);
}

/** Validate and verify a `res` card. Returns normalized signed fields or null. */
export async function verifyCardResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || response.k !== 'res') return null;
  const hasFields = ['bio', 'avatar', 'socials', 'tip'].some(key => own(response, key));
  const hasIdentity = own(response, 'ck') || own(response, 'pr');
  if (!hasFields && !hasIdentity) return { empty: true };
  if (typeof response.ck !== 'string' || !PUB_RE.test(response.ck) || typeof response.pr !== 'string' || !SIG_RE.test(response.pr)) return null;
  const fields = normalizeCardFields(response);
  if (!fields) return null;
  const ok = await verifySignature(response.ck, response.pr, cardProfileMessage(fields));
  if (!ok) return null;
  return { ...fields, ck: response.ck, pr: response.pr };
}

/** Verify the possession response against the pending room, peer IDs, nonce, and card key. */
export async function verifyCardChallenge(roomId, requesterPeerId, ownerPeerId, nonce, response, publicKey) {
  if (typeof roomId !== 'string' || !roomId || typeof requesterPeerId !== 'string' || !requesterPeerId ||
      typeof ownerPeerId !== 'string' || !ownerPeerId || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return false;
  if (!response || typeof response !== 'object' || Array.isArray(response) || response.k !== 'a' || response.n !== nonce) return false;
  return verifySignature(publicKey, response.sig, cardChallengeMessage(roomId, requesterPeerId, ownerPeerId, nonce));
}

async function createIdentity() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const ck = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const sk = b64u(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const privateKey = await crypto.subtle.importKey('pkcs8', unb64u(sk), ECDSA, false, ['sign']);
  writePrivateJson(cardKeyPath(), { ck, sk });
  return { ck, privateKey };
}

async function loadIdentity() {
  const saved = readJson(cardKeyPath());
  if (!saved || typeof saved.ck !== 'string' || !PUB_RE.test(saved.ck) || typeof saved.sk !== 'string' || !/^[A-Za-z0-9_-]{80,200}$/.test(saved.sk)) return null;
  try { fs.chmodSync(configDir(), 0o700); fs.chmodSync(cardKeyPath(), 0o600); } catch {}
  try {
    const publicKey = await crypto.subtle.importKey('raw', unb64u(saved.ck), ECDSA, false, ['verify']);
    const privateKey = await crypto.subtle.importKey('pkcs8', unb64u(saved.sk), ECDSA, false, ['sign']);
    const proof = await crypto.subtle.sign(SIGN_ALG, privateKey, textEncoder.encode('potalk-card-key-check'));
    if (!await crypto.subtle.verify(SIGN_ALG, publicKey, proof, textEncoder.encode('potalk-card-key-check'))) return null;
    return { ck: saved.ck, privateKey };
  } catch { return null; }
}

/** Load the stored, signed card and its separate private key. */
export async function loadCardManager() {
  let identity = await loadIdentity();
  const saved = readJson(cardPath());
  let card = null;
  let invalidCard = false;
  if (saved !== null) {
    const checked = await verifyCardResponse(saved);
    if (identity && checked && !checked.empty && checked.ck === identity.ck) card = checked;
    else invalidCard = true;
  }

  return {
    get card() {
      if (!card) return null;
      const copy = { ...card };
      if (card.socials) copy.socials = { ...card.socials };
      if (card.tip) copy.tip = { ...card.tip };
      return copy;
    },
    get invalidCard() { return invalidCard; },
    response() { return card ? { k: 'res', ...card } : { k: 'res' }; },
    async update(changes) {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('card changes must be an object');
      const fields = card ? { ...Object.fromEntries(['bio', 'avatar'].filter(key => card[key] !== undefined).map(key => [key, card[key]])),
        ...(card.socials ? { socials: { ...card.socials } } : {}), ...(card.tip ? { tip: { ...card.tip } } : {}) } : {};
      for (const key of ['bio', 'avatar', 'socials', 'tip']) {
        if (!own(changes, key)) continue;
        if (changes[key] === null) delete fields[key];
        else if (key === 'socials') {
          const socials = { ...(fields.socials || {}) };
          for (const social of Object.keys(SOCIAL_RULES)) {
            if (!own(changes.socials || {}, social)) continue;
            if (changes.socials[social] === null) delete socials[social];
            else socials[social] = changes.socials[social];
          }
          if (Object.keys(socials).length) fields.socials = socials;
          else delete fields.socials;
        } else fields[key] = changes[key];
      }
      const normalized = normalizeCardFields(fields);
      if (!normalized) throw new TypeError('カードの値が形式に合いません');
      const activeIdentity = identity || await loadIdentity() || await createIdentity();
      const pr = b64u(await crypto.subtle.sign(SIGN_ALG, activeIdentity.privateKey, textEncoder.encode(cardProfileMessage(normalized))));
      const signed = { k: 'res', ...normalized, ck: activeIdentity.ck, pr };
      writePrivateJson(cardPath(), signed);
      identity ||= activeIdentity;
      card = { ...normalized, ck: activeIdentity.ck, pr };
      invalidCard = false;
      return { ...card };
    },
    async answerChallenge(roomId, requesterPeerId, ownerPeerId, nonce) {
      if (!identity || !card || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return null;
      const sig = b64u(await crypto.subtle.sign(SIGN_ALG, identity.privateKey,
        textEncoder.encode(cardChallengeMessage(roomId, requesterPeerId, ownerPeerId, nonce))));
      return { k: 'a', n: nonce, sig };
    }
  };
}

/** Validate one prompt value before it is added to an update. */
export function validateCardField(field, value) {
  if (field === 'bio') return typeof value === 'string' && [...value].length <= 60 && capText(value, 60) === value;
  if (field === 'avatar') return normalizeCardFields({ avatar: value }) !== null;
  if (field === 'socials') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(([key, item]) => SOCIAL_RULES[key] && typeof item === 'string' && SOCIAL_RULES[key].test(item));
  }
  if (field === 'tip') return normalizeCardFields({ tip: value }) !== null;
  return false;
}
