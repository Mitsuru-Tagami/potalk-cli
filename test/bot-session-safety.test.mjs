import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterRoom } from '../lib/session.mjs';

function makeRoom({ canTalk = true } = {}) {
  return {
    roomId: 'safety-room',
    bcast: !canTalk,
    canTalk,
    micMuted: true,
    meta: () => ({ name: 'safety test' }),
    setMicMuted(value) { this.micMuted = value; },
    async leave() {},
  };
}

function makeSession({ canTalk = true, start = () => undefined } = {}) {
  const room = makeRoom({ canTalk });
  const calls = [];
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'safety test' },
    profile: { name: 'tester', emoji: '' },
    lobby: {},
    sound: false,
    onText: text => calls.push(`text:${text}`),
    onChange: () => calls.push('change'),
    openRoomImpl: () => room,
    createTtsImpl: () => ({ speak() {}, close() {} }),
    openMicImpl: () => ({
      start: () => { calls.push('start'); return start(); },
      stop: () => calls.push('stop'),
      readMeter: () => ({ rms: 0, peak: 0, samples: 0 }),
    }),
  });
  return { session, room, calls };
}

test('配信部屋の実sessionはオンを拒否するが、権限なしでもオフは停止する', async () => {
  const state = makeSession({ canTalk: false });
  try {
    state.session.setTalk(true);
    assert.equal(state.room.micMuted, true);
    assert.equal(state.calls.includes('start'), false);

    state.session.setTalk(false);
    assert.equal(state.room.micMuted, true);
    assert.equal(state.calls.filter(call => call === 'stop').length, 1);
  } finally {
    await state.session.leave();
  }
});

test('通話中に話す権限を失ってもオフ操作はマイクを停止する', async () => {
  const state = makeSession();
  try {
    state.session.setTalk(true);
    assert.equal(state.room.micMuted, false);
    state.room.canTalk = false;
    state.session.setTalk(false);
    assert.equal(state.room.micMuted, true);
    assert.equal(state.calls.filter(call => call === 'stop').length, 1);
  } finally {
    await state.session.leave();
  }
});

test('mic.startの同期失敗はミュートを維持し、成功扱いにしない', async () => {
  const state = makeSession({ start: () => false });
  try {
    state.session.setTalk(true);
    assert.equal(state.room.micMuted, true);
    assert.deepEqual(state.calls.filter(call => ['start', 'change'].includes(call)), ['start']);
  } finally {
    await state.session.leave();
  }
});

test('退出後のsetTalk(true)はマイクを起動しない', async () => {
  const state = makeSession();
  await state.session.leave();
  state.session.setTalk(true);
  assert.equal(state.room.micMuted, true);
  assert.equal(state.calls.includes('start'), false);
});

test('bot音声ソースはspeakerやRoom生成より先に検証する', () => {
  let roomCreated = false;
  assert.throws(() => enterRoom({
    target: { roomId: 'invalid-source-room', name: 'invalid' },
    profile: { name: 'tester', emoji: '' },
    lobby: {},
    sound: false,
    pulseSource: 'not-a-bot-source',
    onText: () => {},
    openRoomImpl: () => { roomCreated = true; throw new Error('must not create room'); },
    createTtsImpl: () => ({ speak() {}, close() {} }),
  }), TypeError);
  assert.equal(roomCreated, false);
});
