import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { enterRoom } from '../lib/session.mjs';
import { completeRoomCommand, roomCommandMatches } from '../lib/commands.mjs';
import { KONAMI_KEY_SEQUENCE_LABEL } from '../lib/easter-egg.mjs';

function makeSession() {
  const messages = [];
  const sent = [];
  const room = {
    roomId: 'test-room', bcast: false, canTalk: false, micMuted: true, talking: false,
    meta: () => ({ name: 'test room', tag: '', tagBy: '' }),
    members: () => [], growthStage: () => '🌱',
    sendChat(text) { sent.push(text); return { ok: true, text, cut: false, wait: 0 }; },
    async leave() {}
  };
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'test room' },
    profile: { name: 'CLI', emoji: '💻' },
    lobby: { announce() {}, rooms: () => [] }, sound: false,
    onText: message => messages.push(message),
    openRoomImpl: () => room,
    createTtsImpl: () => ({ speak() {}, close() {} })
  });
  return { session, messages, sent };
}

test('/bossはコマンドとして処理・補完されない', async () => {
  const state = makeSession();
  try {
    assert.deepEqual(roomCommandMatches('/bo'), []);
    assert.deepEqual(completeRoomCommand('/boss'), [[], '/boss']);
    assert.equal(state.session.command('/boss'), false);
    assert.deepEqual(state.sent, [], '/boss must not be sent as a chat command');
  } finally {
    await state.session.leave();
  }
});

test('/helpとptk helpに/bossの説明がない', async () => {
  const state = makeSession();
  try {
    state.session.command('/help');
    assert.equal(state.messages.some(message => message.includes('/boss')), false);
  } finally {
    await state.session.leave();
  }

  const result = spawnSync(process.execPath, [new URL('../ptk.mjs', import.meta.url).pathname, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\/boss/u);
});

test('部屋では秘密配列は普通のチャットで、/konamiも起動コマンドではない', async () => {
  const state = makeSession();
  try {
    const result = state.session.say(KONAMI_KEY_SEQUENCE_LABEL);
    assert.equal(result.easterEgg, undefined);
    assert.deepEqual(state.sent, [KONAMI_KEY_SEQUENCE_LABEL]);
    assert.deepEqual(roomCommandMatches('/k'), []);
    assert.equal(state.session.command('/konami'), false);
    const helpStart = state.messages.length;
    state.session.command('/help');
    assert.equal(state.messages.slice(helpStart).some(message => message.includes('/konami')), false);
    assert.deepEqual(state.sent, [KONAMI_KEY_SEQUENCE_LABEL]);
  } finally {
    await state.session.leave();
  }
});
