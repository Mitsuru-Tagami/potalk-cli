import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterRoom } from '../lib/session.mjs';

function fakeSessionRoom(requests) {
  return {
    roomId: 'test-room', bcast: false, canTalk: false, micMuted: true, talking: false,
    meta: () => ({ name: 'test room', tag: '', tagBy: '' }),
    members: () => [{ id: 'peer-2', label: '相手' }],
    requestCard: (peerId, options) => { requests.push({ peerId, options }); return true; },
    growthStage: () => '🌱',
    async leave() {}
  };
}

test('/card <番号> --verifyだけがSNS照合を要求し、通常の/cardは外部照会しない', async () => {
  const requests = [], messages = [];
  const room = fakeSessionRoom(requests);
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'test room' },
    profile: { name: 'CLI', emoji: '💻' },
    lobby: { announce() {}, rooms: () => [] },
    sound: false,
    onText: message => messages.push(message),
    openRoomImpl: () => room
  });
  try {
    assert.equal(session.command('/card 2'), true);
    assert.deepEqual(requests.at(-1), { peerId: 'peer-2', options: { verifySocials: false } });
    assert.match(messages.at(-1), /外部照会は行わず/);

    assert.equal(session.command('/card 2 --verify'), true);
    assert.deepEqual(requests.at(-1), { peerId: 'peer-2', options: { verifySocials: true } });
    assert.match(messages.at(-1), /接続元IPが照合先に伝わる場合があります/);

    const count = requests.length;
    assert.equal(session.command('/card 2 --verify extra'), true);
    assert.equal(requests.length, count);
    assert.match(messages.at(-1), /使用方法：\/card <番号> \[--verify\]/);
  } finally {
    await session.leave();
  }
});
