import { nip19, verifyEvent } from 'nostr-tools';

const KEY_RE = /^[A-Za-z0-9_-]{87}$/;
const X_ID_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_POST_RE = /^\d{1,25}$/;
const GITHUB_ID_RE = /^[A-Za-z0-9-]{1,39}$/;
const NOSTR_ID_RE = /^npub1[0-9a-z]{58}$/;
const SUPPORTED_SOCIALS = new Set(['x', 'github', 'nostr']);
const CARD_NOSTR_KIND = 30078;
const MAX_RESPONSE_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 8000;
const b64u = value => Buffer.from(value).toString('base64url');

/** Fingerprint line used by the production card protocol's SNS proofs. */
export async function cardKeyProofLine(ck) {
  if (typeof ck !== 'string' || !KEY_RE.test(ck)) return null;
  const raw = Buffer.from(ck, 'base64url');
  if (raw.length !== 65 || raw[0] !== 4 || raw.toString('base64url') !== ck) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  return `potalk1-${b64u(digest.subarray(0, 16))}`;
}

async function fetchJson(fetchImpl, url, headers, timeoutMs) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'network' };
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error'
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!response?.ok) return { ok: false, reason: response?.status === 404 ? 'not-found' : 'http' };
  let text;
  try { text = await response.text(); }
  catch { return { ok: false, reason: 'response' }; }
  if (typeof text !== 'string' || text.length > MAX_RESPONSE_CHARS) return { ok: false, reason: 'response' };
  try { return { ok: true, data: JSON.parse(text) }; }
  catch { return { ok: false, reason: 'response' }; }
}

function result(status, reason) {
  return reason ? { status, reason } : { status };
}

async function checkXProof(handle, postId, line, fetchImpl, timeoutMs) {
  if (!X_ID_RE.test(handle) || !X_POST_RE.test(postId)) return result('failed', 'invalid-proof');
  const endpoint = new URL('https://publish.x.com/oembed');
  endpoint.searchParams.set('omit_script', '1');
  endpoint.searchParams.set('url', `https://x.com/${handle}/status/${postId}`);
  const response = await fetchJson(fetchImpl, endpoint.toString(), { Accept: 'application/json' }, timeoutMs);
  if (!response.ok) return result('error', response.reason);
  const data = response.data;
  const author = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(String(data?.author_url || ''))?.[1];
  if (!author || author.toLowerCase() !== handle.toLowerCase()) return result('failed', 'author');
  return String(data?.html || '').includes(line) ? result('verified') : result('failed', 'fingerprint');
}

async function checkGithubProof(login, line, fetchImpl, timeoutMs) {
  if (!GITHUB_ID_RE.test(login)) return result('failed', 'invalid-account');
  const endpoint = `https://api.github.com/users/${encodeURIComponent(login)}`;
  const response = await fetchJson(fetchImpl, endpoint, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'potalk-cli'
  }, timeoutMs);
  if (!response.ok) return result(response.reason === 'not-found' ? 'failed' : 'error', response.reason);
  const data = response.data;
  if (String(data?.login || '').toLowerCase() !== login.toLowerCase()) return result('failed', 'account');
  return String(data?.bio || '').includes(line) ? result('verified') : result('failed', 'fingerprint');
}

function checkNostrProof(npub, event, line) {
  if (!NOSTR_ID_RE.test(npub) || !event || typeof event !== 'object' || Array.isArray(event)) {
    return result('failed', 'invalid-proof');
  }
  let expectedPubkey = '';
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub' && typeof decoded.data === 'string') expectedPubkey = decoded.data;
  } catch {}
  if (!expectedPubkey || event.pubkey !== expectedPubkey) return result('failed', 'author');
  if (event.kind !== CARD_NOSTR_KIND || !Array.isArray(event.tags) ||
      !event.tags.some(tag => Array.isArray(tag) && tag[0] === 'd' && tag[1] === 'potalk-card')) {
    return result('failed', 'event-shape');
  }
  if (typeof event.content !== 'string' || !event.content.includes(line)) return result('failed', 'fingerprint');
  const cleanEvent = {
    id: event.id, pubkey: event.pubkey, sig: event.sig, kind: event.kind,
    created_at: event.created_at, tags: event.tags.map(tag => [...tag]), content: event.content
  };
  try { return verifyEvent(cleanEvent) ? result('verified') : result('failed', 'signature'); }
  catch { return result('failed', 'signature'); }
}

/**
 * Verify only production-defined SNS proofs. Call this only after the peer-bound
 * card-key challenge succeeds and the recipient explicitly requested SNS checks.
 * A successful result binds control of the SNS account/key to the card key; it
 * does not establish a human identity or make the unsigned card body truthful.
 */
export async function verifyCardSocialProofs(card, {
  keyVerified = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const socials = card?.socials && typeof card.socials === 'object' && !Array.isArray(card.socials) ? card.socials : {};
  const services = Object.keys(socials).filter(service => typeof socials[service] === 'string');
  const checks = {};
  if (!services.length) return checks;
  if (keyVerified !== true) {
    for (const service of services) checks[service] = result('blocked', 'card-key-unverified');
    return checks;
  }

  let line;
  try { line = await cardKeyProofLine(card?.ck); }
  catch { line = null; }
  if (!line) {
    for (const service of services) checks[service] = result('blocked', 'invalid-card-key');
    return checks;
  }

  const proofs = card?.pr && typeof card.pr === 'object' && !Array.isArray(card.pr) ? card.pr : {};
  const pending = services.map(async service => {
    if (!SUPPORTED_SOCIALS.has(service)) return [service, result('unsupported')];
    if (service === 'x') {
      if (!proofs.x) return [service, result('missing')];
      return [service, await checkXProof(socials.x, proofs.x, line, fetchImpl, timeoutMs)];
    }
    if (service === 'github') {
      if (proofs.github !== 1) return [service, result('missing')];
      return [service, await checkGithubProof(socials.github, line, fetchImpl, timeoutMs)];
    }
    if (!proofs.nostr) return [service, result('missing')];
    return [service, checkNostrProof(socials.nostr, proofs.nostr, line)];
  });
  for (const [service, check] of await Promise.all(pending)) checks[service] = check;
  return checks;
}
