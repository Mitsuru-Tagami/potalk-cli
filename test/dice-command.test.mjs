import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterRoom } from '../lib/session.mjs';

function fakeSessionRoom({ sendOk = true } = {}) {
  const sent = [];
  return {
    roomId: 'test-room', bcast: false, canTalk: false, micMuted: true, talking: false, sent,
    meta: () => ({ name: 'test room', tag: '', tagBy: '' }),
    members: () => [],
    growthStage: () => '🌱',
    sendChat(text) {
      sent.push(text);
      return { ok: sendOk, text, cut: false, wait: sendOk ? 0 : 1000 };
    },
    async leave() {}
  };
}

function makeSession({ room = fakeSessionRoom(), messages = [], received = [], spoken = [] } = {}) {
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'test room' },
    profile: { name: 'CLI', emoji: '💻' },
    lobby: { announce() {}, rooms: () => [] },
    sound: false,
    onText: message => messages.push(message),
    onReceivedChat: event => received.push(event),
    openRoomImpl: () => room,
    createTtsImpl: () => ({ speak: text => { spoken.push(text); return true; }, close() {} })
  });
  return { session, room, messages, received, spoken };
}

function assertRoll(message, sides) {
  const match = message.match(new RegExp(`^🎲 ${sides}面ダイス: ([0-9]+)$`, 'u'));
  assert.ok(match, message);
  const result = Number(match[1]);
  assert.ok(result >= 1 && result <= sides, message);
}

test('/dice と /dice N は出目を自分のチャットとして送信し、TTSで読み上げる', async () => {
  const state = makeSession();
  try {
    assert.equal(state.session.command('/dice'), true);
    assert.equal(state.session.command('/dice 20'), true);
    assert.equal(state.room.sent.length, 2);
    assertRoll(state.room.sent[0], 6);
    assertRoll(state.room.sent[1], 20);
    assert.deepEqual(state.spoken, state.room.sent);
    assert.deepEqual(state.received, []);
    assert.ok(state.messages.some(message => message.includes('💻CLI（あなた）：🎲')));
  } finally {
    await state.session.leave();
  }
});

test('/dice の不正な値は送信も読み上げもせず、エラーを表示する', async () => {
  const state = makeSession();
  try {
    for (const command of ['/dice 0', '/dice abc', '/dice 2 3']) {
      assert.equal(state.session.command(command), true);
    }
    assert.deepEqual(state.room.sent, []);
    assert.deepEqual(state.spoken, []);
    assert.ok(state.messages.some(message => /面数|使用方法/u.test(message)));
    assert.deepEqual(state.received, []);
  } finally {
    await state.session.leave();
  }
});

test('/dice は送信制限中でもローカルに出目を表示する', async () => {
  const state = makeSession({ room: fakeSessionRoom({ sendOk: false }) });
  try {
    assert.equal(state.session.command('/dice'), true);
    assert.equal(state.room.sent.length, 1);
    assertRoll(state.messages.find(message => /^🎲 6面ダイス/u.test(message))?.replace(/（チャットに送信できませんでした）$/u, ''), 6);
    assert.equal(state.spoken.length, 1);
    assert.deepEqual(state.received, []);
  } finally {
    await state.session.leave();
  }
});
