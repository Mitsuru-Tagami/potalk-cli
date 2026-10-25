import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serializePresence } from '../lib/events.mjs';
import { openRoom } from '../lib/room.mjs';
import { enterRoom } from '../lib/session.mjs';

test('入室イベントを構造化JSONLへシリアライズする', () => {
  const serialized = serializePresence({ action: 'join', name: '🦊あき' });
  assert.equal(serialized.includes('\n'), false);
  assert.deepEqual(JSON.parse(serialized), {
    type: 'presence', action: 'join', name: '🦊あき'
  });
});

test('退出イベントではclean状態を保ち、chat形式には影響しない', () => {
  assert.deepEqual(JSON.parse(serializePresence({ action: 'leave', name: '🐱相手', clean: false })), {
    type: 'presence', action: 'leave', name: '🐱相手', clean: false
  });
  assert.deepEqual(JSON.parse(serializePresence({ action: 'leave', name: '🐱相手' })), {
    type: 'presence', action: 'leave', name: '🐱相手'
  });
});

test('入退室イベントにはaction・表示名・boolean cleanだけを受け付ける', () => {
  assert.throws(() => serializePresence({ action: 'chat', name: '相手' }), TypeError);
  assert.throws(() => serializePresence({ action: 'join', name: '' }), TypeError);
  assert.deepEqual(JSON.parse(serializePresence({ action: 'join', name: '  ' })), {
    type: 'presence', action: 'join', name: '  '
  });
  assert.throws(() => serializePresence({ action: 'leave', name: '相手', clean: 'yes' }), TypeError);
});

test('CLIはプロフィール確認後の参加者だけをpresence対象にする', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-presence-'));
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configDir;
  const actions = new Map();
  const events = [];
  const fakeRoom = {
    makeAction(name) {
      const action = { onMessage: null, send: () => Promise.resolve() };
      actions.set(name, action);
      return action;
    },
    addStream() {},
    removeStream() {},
    async leave() {}
  };
  let room;
  try {
    room = openRoom({
      roomId: 'presence-known-participant-test',
      profile: { name: 'POTBOT', emoji: '🤖' },
      lobby: { announce() {} },
      joinRoomImpl: () => fakeRoom,
      outgoingStreamImpl: () => null,
      onEvent: event => events.push(event)
    });
    fakeRoom.onPeerJoin('unknown-peer');
    fakeRoom.onPeerLeave('unknown-peer');
    fakeRoom.onPeerJoin('known-peer');
    await actions.get('profile').onMessage(
      { name: '表示される人', emoji: '🦊', muted: false, since: 2 },
      { peerId: 'known-peer' }
    );
    fakeRoom.onPeerLeave('known-peer');
    assert.deepEqual(events.filter(event => event.type === 'join' || event.type === 'leave'), [
      { type: 'join', who: '🦊表示される人' },
      { type: 'leave', who: '🦊表示される人', clean: false }
    ]);
  } finally {
    if (room) await room.leave();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('enterRoom経由で既知参加者のpresenceを通知し、既存画面通知を保つ', async () => {
  const messages = [];
  const presence = [];
  let emitRoomEvent;
  const room = {
    roomId: 'presence-session-test',
    bcast: false,
    canTalk: false,
    micMuted: true,
    talking: false,
    meta: () => ({ name: 'presence test' }),
    growthStage: () => '🌱',
    members: () => [],
    async leave() {}
  };
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'presence test' },
    profile: { name: 'POTBOT', emoji: '🤖' },
    lobby: { announce() {}, rooms: () => [] },
    sound: false,
    onText: message => messages.push(message),
    onPresence: event => presence.push(event),
    openRoomImpl: options => { emitRoomEvent = options.onEvent; return room; },
    createTtsImpl: () => ({ speak() {}, close() {} })
  });

  try {
    emitRoomEvent({ type: 'join', who: '🦊相手' });
    emitRoomEvent({ type: 'leave', who: '🦊相手', clean: true });
    emitRoomEvent({ type: 'leave', who: '🐱相手', clean: false });
    assert.deepEqual(presence, [
      { action: 'join', name: '🦊相手' },
      { action: 'leave', name: '🦊相手', clean: true },
      { action: 'leave', name: '🐱相手', clean: false }
    ]);
    assert.ok(messages.some(message => message.includes('🦊相手 とつながりました')));
    assert.ok(messages.some(message => message.includes('🦊相手 が退出しました')));
    assert.ok(messages.some(message => message.includes('🐱相手 との接続が切れました')));
  } finally {
    await session.leave();
  }
});
