import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { cardKeyProofLine, verifyCardSocialProofs } from '../lib/card-proof.mjs';

async function makeCardKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function makeProofCard() {
  const ck = await makeCardKey();
  const line = await cardKeyProofLine(ck);
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const npub = nip19.npubEncode(pubkey);
  const nostr = finalizeEvent({
    kind: 30078,
    created_at: 1,
    tags: [['d', 'potalk-card']],
    content: `Card proof: ${line}`
  }, secret);
  return {
    ck, line,
    card: {
      ck,
      socials: {
        x: 'tagami_1', github: 'Mitsuru-Tagami', nostr: npub,
        note: 'tagami_1', instagram: 'tagami.photo', youtube: '@tagami'
      },
      pr: { x: '1234567890', github: 1, nostr }
    }
  };
}

test('本家のX・GitHub・Nostr proofがそれぞれ名刺鍵との紐付けを確認し、未対応SNSは確認しない', async () => {
  const { card, line } = await makeProofCard();
  const requested = [];
  const checks = await verifyCardSocialProofs(card, {
    keyVerified: true,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requested.push({ parsed, options });
      if (parsed.hostname === 'publish.x.com') {
        assert.equal(parsed.searchParams.get('omit_script'), '1');
        assert.equal(parsed.searchParams.get('url'), 'https://x.com/tagami_1/status/1234567890');
        return jsonResponse({ author_url: 'https://x.com/TAGAMI_1', html: `<blockquote>${line}</blockquote>` });
      }
      if (parsed.hostname === 'api.github.com') {
        assert.equal(parsed.pathname, '/users/Mitsuru-Tagami');
        assert.equal(options.headers['User-Agent'], 'potalk-cli');
        return jsonResponse({ login: 'Mitsuru-Tagami', bio: `hello ${line}` });
      }
      throw new Error(`unexpected service ${parsed.hostname}`);
    }
  });
  assert.deepEqual(checks.x, { status: 'verified' });
  assert.deepEqual(checks.github, { status: 'verified' });
  assert.deepEqual(checks.nostr, { status: 'verified' });
  assert.deepEqual(checks.note, { status: 'unsupported' });
  assert.deepEqual(checks.instagram, { status: 'unsupported' });
  assert.deepEqual(checks.youtube, { status: 'unsupported' });
  assert.equal(requested.length, 2, 'Nostr proof is verified locally without a relay lookup');
});

test('X投稿者・GitHub bio・Nostr署名が食い違う場合はどれも確認済みにしない', async () => {
  const { card, line } = await makeProofCard();
  card.pr.nostr = { ...card.pr.nostr, content: `changed ${line}` };
  const checks = await verifyCardSocialProofs(card, {
    keyVerified: true,
    fetchImpl: async url => {
      if (new URL(url).hostname === 'publish.x.com') {
        return jsonResponse({ author_url: 'https://x.com/attacker', html: `<p>${line}</p>` });
      }
      return jsonResponse({ login: 'Mitsuru-Tagami', bio: 'no proof here' });
    }
  });
  assert.deepEqual(checks.x, { status: 'failed', reason: 'author' });
  assert.deepEqual(checks.github, { status: 'failed', reason: 'fingerprint' });
  assert.deepEqual(checks.nostr, { status: 'failed', reason: 'signature' });
});

test('明示要求があっても名刺鍵未確認なら外部照会せず、証拠不足と接続エラーは未確認のまま', async () => {
  const { card } = await makeProofCard();
  let calls = 0;
  const blocked = await verifyCardSocialProofs(card, {
    keyVerified: false,
    fetchImpl: async () => { calls++; throw new Error('must not query'); }
  });
  assert.equal(blocked.x.status, 'blocked');
  assert.equal(blocked.github.status, 'blocked');
  assert.equal(blocked.nostr.status, 'blocked');
  assert.equal(calls, 0);

  const missingCard = { ck: card.ck, socials: { x: 'tagami_1', github: 'Mitsuru-Tagami', nostr: card.socials.nostr } };
  const missing = await verifyCardSocialProofs(missingCard, { keyVerified: true, fetchImpl: async () => { calls++; } });
  assert.deepEqual(missing.x, { status: 'missing' });
  assert.deepEqual(missing.github, { status: 'missing' });
  assert.deepEqual(missing.nostr, { status: 'missing' });
  assert.equal(calls, 0);

  const networkError = await verifyCardSocialProofs(card, {
    keyVerified: true,
    fetchImpl: async () => jsonResponse({ message: 'rate limit' }, 429)
  });
  assert.equal(networkError.x.status, 'error');
  assert.equal(networkError.github.status, 'error');
  assert.notEqual(networkError.x.status, 'verified');
});
