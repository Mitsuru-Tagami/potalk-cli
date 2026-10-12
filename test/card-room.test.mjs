import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selfId } from 'trystero/nostr';
import { openRoom } from '../lib/room.mjs';
import { loadCardManager } from '../lib/card.mjs';

function createFakeRoom() {
  const actions = new Map();
  const sent = [];
  const room = {
    makeAction(name) {
      const action = {
        onMessage: null,
        send(data, options) { sent.push({ name, data, options }); return Promise.resolve(); }
      };
      actions.set(name, action);
      return action;
    },
    addStream() {},
    removeStream() {},
    async leave() {}
  };
  return { room, actions, sent };
}

test('room action accepts production proof objects and keeps failed or absent checks unverified', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-card-room-'));
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configDir;
  const fake = createFakeRoom();
  const events = [];
  let room, socialVerificationCalls = 0;
  try {
    const ownerCard = await loadCardManager();
    await ownerCard.update({ bio: '本番プロトコル', socials: { github: 'Mitsuru-Tagami' } });
    const peerId = 'card-peer';
    room = openRoom({
      roomId: 'card-room-test', profile: { name: 'CLI', emoji: '💻' },
      cardManager: null, lobby: { announce() {} },
      joinRoomImpl: () => fake.room, outgoingStreamImpl: () => null,
      verifyCardSocialProofsImpl: async (_card, options) => {
        assert.equal(options.keyVerified, true);
        socialVerificationCalls++;
        return { github: { status: 'verified' } };
      },
      onEvent: event => events.push(event)
    });
    fake.room.onPeerJoin(peerId);
    await fake.actions.get('profile').onMessage({ name: '相手', emoji: '🦊', muted: false, since: 1 }, { peerId });

    assert.equal(room.requestCard(peerId), true);
    const productionPayload = { ...ownerCard.response(), pr: { github: 1 } };
    await fake.actions.get('card').onMessage(productionPayload, { peerId });
    const query = fake.sent.filter(item => item.name === 'card' && item.data?.k === 'q').at(-1).data;
    assert.ok(query?.n);
    const goodAnswer = await ownerCard.answerChallenge('card-room-test', selfId, peerId, query.n);
    await fake.actions.get('card').onMessage(goodAnswer, { peerId });
    const verifiedKeyEvent = events.filter(event => event.type === 'card').at(-1);
    assert.equal(verifiedKeyEvent.keyVerified, true);
    assert.equal(verifiedKeyEvent.card.pr.github, 1);
    assert.equal(verifiedKeyEvent.card.bio, '本番プロトコル');
    assert.equal(socialVerificationCalls, 0, 'ordinary card fetch does not verify SNS proofs');

    assert.equal(room.requestCard(peerId, { verifySocials: true }), true);
    await fake.actions.get('card').onMessage(productionPayload, { peerId });
    const secondQuery = fake.sent.filter(item => item.name === 'card' && item.data?.k === 'q').at(-1).data;
    const wrongRoomAnswer = await ownerCard.answerChallenge('different-room', selfId, peerId, secondQuery.n);
    await fake.actions.get('card').onMessage(wrongRoomAnswer, { peerId });
    const unverifiedEvent = events.filter(event => event.type === 'card').at(-1);
    assert.equal(unverifiedEvent.keyVerified, false);
    assert.equal(unverifiedEvent.keyVerificationReason, 'failed');
    assert.equal(unverifiedEvent.card.bio, '本番プロトコル');
    assert.equal(unverifiedEvent.socialVerificationRequested, true);
    assert.equal(socialVerificationCalls, 0, 'SNS lookups are skipped when the key challenge fails');

    assert.equal(room.requestCard(peerId, { verifySocials: true }), true);
    await fake.actions.get('card').onMessage(productionPayload, { peerId });
    const thirdQuery = fake.sent.filter(item => item.name === 'card' && item.data?.k === 'q').at(-1).data;
    const thirdAnswer = await ownerCard.answerChallenge('card-room-test', selfId, peerId, thirdQuery.n);
    await fake.actions.get('card').onMessage(thirdAnswer, { peerId });
    const snsVerifiedEvent = events.filter(event => event.type === 'card').at(-1);
    assert.equal(socialVerificationCalls, 1);
    assert.equal(snsVerifiedEvent.keyVerified, true);
    assert.equal(snsVerifiedEvent.socialVerificationRequested, true);
    assert.deepEqual(snsVerifiedEvent.socialVerification.github, { status: 'verified' });

    assert.equal(room.requestCard(peerId), true);
    const beforeQ = fake.sent.filter(item => item.name === 'card' && item.data?.k === 'q').length;
    await fake.actions.get('card').onMessage({ k: 'res', bio: '鍵のない旧カード', pr: 'legacy-string' }, { peerId });
    const noKeyEvent = events.filter(event => event.type === 'card').at(-1);
    assert.equal(noKeyEvent.keyVerified, false);
    assert.equal(noKeyEvent.keyVerificationReason, 'no-key');
    assert.equal(noKeyEvent.card.pr, undefined);
    assert.equal(fake.sent.filter(item => item.name === 'card' && item.data?.k === 'q').length, beforeQ);
  } finally {
    if (room) await room.leave();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
