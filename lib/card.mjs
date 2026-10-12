// Profile cards for the `card` P2P action, interoperable with the production po-talk protocol.
// The card body is not signed. The separate P-256 key answers a peer-bound possession
// challenge; SNS proofs are data only until a recipient explicitly verifies them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capText } from './text.mjs';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const PUB_RE = /^[A-Za-z0-9_-]{87}$/;
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;
const INCOMING_NONCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SOCIAL_RULES = Object.freeze({
  x: /^[A-Za-z0-9_]{1,15}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
  note: /^[A-Za-z0-9_]{3,32}$/,
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  youtube: /^(?:@[\p{L}\p{N}\p{M}._\-\u00B7]{3,30}|UC[A-Za-z0-9_-]{22})$/u,
  nostr: /^npub1[0-9a-z]{58}$/
});
const TIP_RULES = Object.freeze({
  ofuse: /^[A-Za-z0-9_]{1,30}$/,
  amazon: /^[A-Za-z0-9]{10,20}$/,
  zap: /^(?:[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|npub1[0-9a-z]{58})$/,
  kofi: /^[A-Za-z0-9_]{1,30}$/,
  bmac: /^[A-Za-z0-9_]{1,30}$/
});
// Used only to safely migrate local data written by PR #28; never emitted on the wire.
const LEGACY_SOCIAL_RULES = Object.freeze({
  x: /^[A-Za-z0-9_]{1,15}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
  note: /^[A-Za-z0-9_]{3,32}$/,
  nostr: /^npub1[0-9a-z]{58}$/
});
const LEGACY_TIP_PROVIDERS = new Set(['ofuse', 'zap', 'kofi', 'bmac', 'kampa']);
const LEGACY_TIP_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const LEGACY_TIP_ZAP_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
const AVATAR_RE = /^data:image\/(?:webp|jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const HEX128_RE = /^[0-9a-f]{128}$/;
const textEncoder = new TextEncoder();
const b64u = value => Buffer.from(value).toString('base64url');
const unb64u = value => new Uint8Array(Buffer.from(value, 'base64url'));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const SOCIAL_HOSTS = Object.freeze({
  x: new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']),
  github: new Set(['github.com', 'www.github.com']),
  note: new Set(['note.com', 'www.note.com']),
  instagram: new Set(['instagram.com', 'www.instagram.com']),
  youtube: new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']),
  nostr: new Set(['njump.me', 'www.njump.me'])
});
const TIP_HOSTS = Object.freeze({
  ofuse: new Set(['ofuse.me', 'www.ofuse.me']),
  amazon: new Set(['amazon.co.jp', 'www.amazon.co.jp', 'amazon.jp', 'www.amazon.jp', 'amazon.com', 'www.amazon.com']),
  kofi: new Set(['ko-fi.com', 'www.ko-fi.com']),
  bmac: new Set(['buymeacoffee.com', 'www.buymeacoffee.com'])
});

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

function validAvatar(value) {
  if (typeof value !== 'string' || value.length > 40000) return false;
  const match = value.match(AVATAR_RE);
  if (!match || !match[1] || match[1].length % 4 === 1) return false;
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[1]) return false;
  const mime = value.slice(5, value.indexOf(';'));
  const dimensions = imageDimensions(bytes, mime);
  return !!dimensions && dimensions.width >= 1 && dimensions.height >= 1 && dimensions.width <= 128 && dimensions.height <= 128;
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

function normalizeCardFields(source, { legacy = false } = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const socialRules = legacy ? LEGACY_SOCIAL_RULES : SOCIAL_RULES;
  const result = {};
  if (own(source, 'bio')) {
    if (typeof source.bio !== 'string' || [...source.bio].length > 60 || capText(source.bio, 60) !== source.bio) return null;
    if (source.bio) result.bio = source.bio;
  }
  if (own(source, 'avatar')) {
    if (!validAvatar(source.avatar)) return null;
    result.avatar = source.avatar;
  }
  if (own(source, 'socials')) {
    if (!source.socials || typeof source.socials !== 'object' || Array.isArray(source.socials)) return null;
    const socials = {};
    for (const key of Object.keys(socialRules)) {
      if (!own(source.socials, key)) continue;
      const value = source.socials[key];
      if (typeof value !== 'string' || !socialRules[key].test(value)) return null;
      socials[key] = value;
    }
    if (Object.keys(socials).length) result.socials = socials;
  }
  if (own(source, 'tip')) {
    if (!source.tip || typeof source.tip !== 'object' || Array.isArray(source.tip)) return null;
    const { p, id } = source.tip;
    const valid = legacy
      ? LEGACY_TIP_PROVIDERS.has(p) && typeof id === 'string' && (p === 'zap' ? LEGACY_TIP_ZAP_RE : LEGACY_TIP_ID_RE).test(id)
      : own(TIP_RULES, p) && typeof id === 'string' && TIP_RULES[p].test(id);
    if (!valid) return null;
    result.tip = { p, id };
  }
  return result;
}

// Production clients sanitize fields independently: one bad ID or proof must not discard a whole card.
function sanitizeCardFields(source) {
  const result = {};
  if (typeof source?.bio === 'string') {
    const bio = capText(source.bio, 60);
    if (bio) result.bio = bio;
  }
  if (validAvatar(source?.avatar)) result.avatar = source.avatar;
  if (source?.socials && typeof source.socials === 'object' && !Array.isArray(source.socials)) {
    const socials = {};
    for (const [key, value] of Object.entries(source.socials)) {
      if (own(SOCIAL_RULES, key) && typeof value === 'string' && SOCIAL_RULES[key].test(value)) socials[key] = value;
    }
    if (Object.keys(socials).length) result.socials = socials;
  }
  if (source?.tip && typeof source.tip === 'object' && !Array.isArray(source.tip)) {
    const { p, id } = source.tip;
    if (own(TIP_RULES, p) && typeof id === 'string' && TIP_RULES[p].test(id)) result.tip = { p, id };
  }
  return result;
}

function hasCardContent(card) {
  return !!(card?.bio || card?.avatar || Object.keys(card?.socials || {}).length || card?.tip);
}

function sanitizeNostrEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const { id, pubkey, sig, kind, created_at, tags, content } = event;
  if (!HEX64_RE.test(id || '') || !HEX64_RE.test(pubkey || '') || !HEX128_RE.test(sig || '')) return null;
  if (kind !== 30078 || !Number.isInteger(created_at) || typeof content !== 'string' || content.length > 200) return null;
  if (!Array.isArray(tags) || tags.length > 4 || !tags.every(tag => Array.isArray(tag) && tag.length <= 4 && tag.every(value => typeof value === 'string' && value.length <= 64))) return null;
  return { id, pubkey, sig, kind, created_at, tags: tags.map(tag => [...tag]), content };
}

function sanitizeProofs(proofs) {
  if (!proofs || typeof proofs !== 'object' || Array.isArray(proofs)) return null;
  const result = {};
  if (typeof proofs.x === 'string' && /^\d{1,25}$/.test(proofs.x)) result.x = proofs.x;
  if (proofs.github === 1) result.github = 1;
  const nostr = sanitizeNostrEvent(proofs.nostr);
  if (nostr) result.nostr = nostr;
  return Object.keys(result).length ? result : null;
}

function copyCard(card) {
  if (!card) return null;
  const copy = { ...card };
  if (card.socials) copy.socials = { ...card.socials };
  if (card.tip) copy.tip = { ...card.tip };
  if (card.pr) {
    copy.pr = { ...card.pr };
    if (card.pr.nostr) copy.pr.nostr = { ...card.pr.nostr, tags: card.pr.nostr.tags.map(tag => [...tag]) };
  }
  return copy;
}

function publicKeyBytes(value) {
  if (typeof value !== 'string' || !PUB_RE.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 65 || bytes[0] !== 4 || bytes.toString('base64url') !== value) return null;
  return new Uint8Array(bytes);
}

async function importPublicKey(value) {
  const bytes = publicKeyBytes(value);
  if (!bytes) return null;
  return crypto.subtle.importKey('raw', bytes, ECDSA, false, ['verify']).catch(() => null);
}

function cardChallengeMessage(roomId, requesterPeerId, ownerPeerId, nonce) {
  return `card\n${roomId}\n${requesterPeerId}\n${ownerPeerId}\n${nonce}`;
}

export const newCardNonce = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

async function verifySignature(publicKey, signature, message) {
  if (typeof signature !== 'string' || !SIG_RE.test(signature)) return false;
  const signatureBytes = unb64u(signature);
  if (signatureBytes.length !== 64 || b64u(signatureBytes) !== signature) return false;
  const key = await importPublicKey(publicKey);
  if (!key) return false;
  return crypto.subtle.verify(SIGN_ALG, key, signatureBytes, textEncoder.encode(message)).catch(() => false);
}

/**
 * Sanitize a production `res` payload. `pr` is optional SNS evidence, not a card-body
 * signature; malformed proofs are dropped without discarding otherwise valid fields.
 */
export async function verifyCardResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || response.k !== 'res') return null;
  const fields = sanitizeCardFields(response);
  if (!hasCardContent(fields)) return { empty: true };
  const result = { ...fields };
  const key = await importPublicKey(response.ck);
  if (key) result.ck = response.ck;
  const proofs = sanitizeProofs(response.pr);
  if (proofs) result.pr = proofs;
  return result;
}

/** Verify the key-possession response against the room, both peer IDs, nonce, and card key. */
export async function verifyCardChallenge(roomId, requesterPeerId, ownerPeerId, nonce, response, publicKey) {
  if (typeof roomId !== 'string' || !roomId || typeof requesterPeerId !== 'string' || !requesterPeerId ||
      typeof ownerPeerId !== 'string' || !ownerPeerId || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return false;
  if (!response || typeof response !== 'object' || Array.isArray(response) || response.k !== 'a' || response.n !== nonce) return false;
  return verifySignature(publicKey, response.sig, cardChallengeMessage(roomId, requesterPeerId, ownerPeerId, nonce));
}

async function createIdentity() {
  // Node CLI keys are protected as a 0600 local file. Unlike the browser implementation,
  // they are not hardware/non-extractable keys; this proves possession, not human identity.
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const ck = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const sk = b64u(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const privateKey = await crypto.subtle.importKey('pkcs8', unb64u(sk), ECDSA, false, ['sign']);
  writePrivateJson(cardKeyPath(), { ck, sk });
  return { ck, privateKey };
}

async function loadIdentity() {
  const saved = readJson(cardKeyPath());
  if (!saved || !publicKeyBytes(saved.ck) || typeof saved.sk !== 'string' || !/^[A-Za-z0-9_-]{80,200}$/.test(saved.sk)) return null;
  const secretBytes = unb64u(saved.sk);
  if (b64u(secretBytes) !== saved.sk) return null;
  try { fs.chmodSync(configDir(), 0o700); fs.chmodSync(cardKeyPath(), 0o600); } catch {}
  try {
    const publicKey = await importPublicKey(saved.ck);
    const privateKey = await crypto.subtle.importKey('pkcs8', secretBytes, ECDSA, false, ['sign']);
    if (!publicKey) return null;
    const proof = await crypto.subtle.sign(SIGN_ALG, privateKey, textEncoder.encode('potalk-card-key-check'));
    if (!await crypto.subtle.verify(SIGN_ALG, publicKey, proof, textEncoder.encode('potalk-card-key-check'))) return null;
    return { ck: saved.ck, privateKey };
  } catch { return null; }
}

function legacyCardProfileMessage(fields) {
  const normalized = normalizeCardFields(fields, { legacy: true });
  if (!normalized) throw new TypeError('invalid legacy card fields');
  return 'potalk-card-profile\n1\n' + JSON.stringify(normalized);
}

async function loadStoredCard(saved, identity) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.k !== 'res' || !identity || saved.ck !== identity.ck) return null;
  if (typeof saved.pr === 'string') {
    // Safely migrate the old local format only when its historical signature is valid.
    // Its signature is removed before any network response is built.
    const oldFields = normalizeCardFields(saved, { legacy: true });
    if (!oldFields || !await verifySignature(identity.ck, saved.pr, legacyCardProfileMessage(oldFields))) return null;
    const currentFields = sanitizeCardFields(oldFields); // drops the now-retired `kampa` provider
    return hasCardContent(currentFields) ? { ...currentFields, ck: identity.ck } : null;
  }
  const checked = await verifyCardResponse(saved);
  if (!checked || checked.empty || checked.ck !== identity.ck) return null;
  return { ...checked, ck: identity.ck };
}

/** Load the saved card and its separate P-256 key. */
export async function loadCardManager() {
  let identity = await loadIdentity();
  const saved = readJson(cardPath());
  let card = null;
  let invalidCard = false;
  if (saved !== null) {
    card = await loadStoredCard(saved, identity);
    if (!card) invalidCard = true;
  }

  return {
    get card() { return copyCard(card); },
    get invalidCard() { return invalidCard; },
    response() {
      if (!hasCardContent(card)) return { k: 'res' };
      const result = { k: 'res', ...card };
      // The local P-256 key is only used by the separate q/a challenge; never sign the card body.
      if (identity) result.ck = identity.ck;
      if (typeof result.pr === 'string') delete result.pr;
      return result;
    },
    async update(changes) {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('card changes must be an object');
      const fields = card ? Object.fromEntries(['bio', 'avatar'].filter(key => card[key] !== undefined).map(key => [key, card[key]])) : {};
      if (card?.socials) fields.socials = { ...card.socials };
      if (card?.tip) fields.tip = { ...card.tip };
      const changedSocials = new Set();
      for (const key of ['bio', 'avatar', 'socials', 'tip']) {
        if (!own(changes, key)) continue;
        if (changes[key] === null) {
          if (key === 'socials' && fields.socials) for (const social of Object.keys(fields.socials)) changedSocials.add(social);
          delete fields[key];
        } else if (key === 'socials') {
          const socials = { ...(fields.socials || {}) };
          for (const social of Object.keys(SOCIAL_RULES)) {
            if (!own(changes.socials || {}, social)) continue;
            changedSocials.add(social);
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
      const proofs = sanitizeProofs(card?.pr);
      for (const social of changedSocials) if (proofs) delete proofs[social];
      const safeProofs = proofs && Object.keys(proofs).length ? proofs : null;
      const savedCard = { k: 'res', ...normalized, ck: activeIdentity.ck, ...(safeProofs ? { pr: safeProofs } : {}) };
      writePrivateJson(cardPath(), savedCard);
      identity = activeIdentity;
      card = { ...normalized, ck: activeIdentity.ck, ...(safeProofs ? { pr: safeProofs } : {}) };
      invalidCard = false;
      return copyCard(card);
    },
    async answerChallenge(roomId, requesterPeerId, ownerPeerId, nonce) {
      if (!identity || typeof nonce !== 'string' || !INCOMING_NONCE_RE.test(nonce)) return null;
      const sig = b64u(await crypto.subtle.sign(SIGN_ALG, identity.privateKey,
        textEncoder.encode(cardChallengeMessage(roomId, requesterPeerId, ownerPeerId, nonce))));
      return { k: 'a', n: nonce, sig };
    }
  };
}

function looksLikeUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^www\.[^\s/]+(?:\/|$)/i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}\/[^\s]*/i.test(value);
}

function urlParts(value, allowedHosts) {
  const text = String(value ?? '').trim();
  if (!looksLikeUrl(text)) return { isUrl: false, parts: [] };
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !allowedHosts.has(url.hostname.toLowerCase())) return { isUrl: true, parts: null };
    const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    return { isUrl: true, parts };
  } catch { return { isUrl: true, parts: null }; }
}

/** Parse a production-compatible SNS ID from either a canonical ID or its public profile URL. */
export function normalizeSocialId(service, value) {
  if (!own(SOCIAL_RULES, service) || typeof value !== 'string') return null;
  let text = value.trim();
  let candidate = text;
  const parsed = urlParts(text, SOCIAL_HOSTS[service]);
  if (parsed.isUrl) {
    if (!parsed.parts?.length) return null;
    if (service === 'youtube') candidate = parsed.parts[0] === 'channel' ? parsed.parts[1] : parsed.parts[0];
    else candidate = parsed.parts[0];
  } else if (service === 'nostr' && /^nostr:/i.test(text)) {
    candidate = text.replace(/^nostr:/i, '');
  }
  if (service === 'x' || service === 'instagram') candidate = candidate.replace(/^@/, '');
  if (service === 'youtube') {
    if (/^UC[A-Za-z0-9_-]{22}$/.test(candidate)) return candidate;
    if (!candidate.startsWith('@')) candidate = `@${candidate}`;
  }
  if (service === 'nostr') {
    const match = candidate.match(/npub1[0-9a-z]{58}/i);
    candidate = match ? match[0].toLowerCase() : candidate;
  }
  return SOCIAL_RULES[service].test(candidate) ? candidate : null;
}

/** Parse a production-compatible tip destination from a canonical ID or provider URL. */
export function normalizeTipId(provider, value) {
  if (!own(TIP_RULES, provider) || typeof value !== 'string') return null;
  let text = value.trim();
  let candidate = text;
  if (provider === 'zap') {
    candidate = text.replace(/^lightning:/i, '').replace(/^nostr:/i, '');
    const parsed = urlParts(candidate, SOCIAL_HOSTS.nostr);
    if (parsed.isUrl) {
      if (!parsed.parts?.length) return null;
      candidate = parsed.parts[0];
    }
    if (/^npub1[0-9a-z]{58}$/i.test(candidate)) candidate = candidate.toLowerCase();
    return TIP_RULES.zap.test(candidate) ? candidate : null;
  }
  const parsed = urlParts(text, TIP_HOSTS[provider]);
  if (parsed.isUrl) {
    if (!parsed.parts) return null;
    if (provider === 'ofuse') candidate = parsed.parts[0] === 'users' ? parsed.parts[1] : parsed.parts[0];
    else if (provider === 'amazon') {
      const index = parsed.parts.indexOf('hz');
      candidate = index >= 0 && parsed.parts[index + 1] === 'wishlist' && parsed.parts[index + 2] === 'ls' ? parsed.parts[index + 3] : '';
    } else candidate = parsed.parts[0];
  }
  return typeof candidate === 'string' && TIP_RULES[provider].test(candidate) ? candidate : null;
}

/** Validate one prompt value before it is added to an update. */
export function validateCardField(field, value) {
  if (field === 'bio') return typeof value === 'string' && [...value].length <= 60 && capText(value, 60) === value;
  if (field === 'avatar') return normalizeCardFields({ avatar: value }) !== null;
  if (field === 'socials') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(([key, item]) => own(SOCIAL_RULES, key) && typeof item === 'string' && SOCIAL_RULES[key].test(item));
  }
  if (field === 'tip') return normalizeCardFields({ tip: value }) !== null;
  return false;
}
