import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { enterRoom } from '../lib/session.mjs';
import { CHAT_MAX } from '../lib/config.mjs';

function fakeSessionRoom({ sendOk = true } = {}) {
  const sent = [];
  return {
    roomId: 'test-room', bcast: false, canTalk: false, micMuted: true, talking: false, sent,
    meta: () => ({ name: 'test room', tag: '', tagBy: '' }),
    members: () => [],
    growthStage: () => '🌱',
    sendChat(text) { sent.push(text); return { ok: sendOk, text, cut: false, wait: sendOk ? 0 : 1000 }; },
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

test('/seiza は88星座解説、/uranai は12星座占い、/omikuji はおみくじを通常チャットとして送信する', async () => {
  const state = makeSession();
  try {
    for (const command of ['/seiza', '/seiza オリオン', '/uranai', '/uranai 牡羊座', '/omikuji']) {
      assert.equal(state.session.command(command), true);
    }
    assert.equal(state.room.sent.length, 5);
    for (const message of state.room.sent) {
      assert.equal(/[\r\n\u2028\u2029]/u.test(message), false, message);
      assert.ok([...message].length <= CHAT_MAX, message);
    }
    assert.match(state.room.sent[0], /^.+座：.+$/u);
    assert.match(state.room.sent[1], /^オリオン座：.+$/u);
    assert.match(state.room.sent[2], /^.+座の占い：.+$/u);
    assert.match(state.room.sent[3], /^牡羊座の占い：.+$/u);
    assert.match(state.room.sent[4], /^(大吉|吉|中吉|小吉|末吉|凶)｜ひとこと：.+今日の提案：.+$/u);
    assert.deepEqual(state.spoken, state.room.sent);
    assert.deepEqual(state.received, [], 'locally sent messages are not received JSONL events');
    assert.ok(state.messages.some(message => message.includes('💻CLI（あなた）：')));
  } finally {
    await state.session.leave();
  }
});

test('/seiza・/uranai・/omikuji の不正な引数は送信もTTSもしない', async () => {
  const state = makeSession();
  try {
    for (const command of ['/seiza どらごん座', '/seiza オリオン extra', '/uranai どらごん座', '/uranai 牡羊座 extra', '/omikuji 大吉']) {
      assert.equal(state.session.command(command), true);
    }
    assert.deepEqual(state.room.sent, []);
    assert.deepEqual(state.spoken, []);
    assert.ok(state.messages.some(message => message.includes('使用方法：/seiza')));
    assert.ok(state.messages.some(message => message.includes('指定できる星座')));
    assert.ok(state.messages.some(message => message.includes('使用方法：/omikuji')));
    assert.deepEqual(state.received, []);
  } finally {
    await state.session.leave();
  }
});

test('/seiza・/uranai・/omikuji は送信制限中もローカル表示してTTSへ渡す', async () => {
  const state = makeSession({ room: fakeSessionRoom({ sendOk: false }) });
  try {
    state.session.command('/seiza 水瓶座');
    state.session.command('/uranai 水瓶座');
    state.session.command('/omikuji');
    assert.equal(state.room.sent.length, 3);
    assert.deepEqual(state.spoken, state.room.sent);
    assert.equal(state.messages.filter(message => message.includes('チャットに送信できませんでした')).length, 3);
    assert.deepEqual(state.received, []);
  } finally {
    await state.session.leave();
  }
});

test('/help は /seiza・/uranai・/omikuji を用途別に案内する', async () => {
  const state = makeSession();
  try {
    state.session.command('/help');
    assert.ok(state.messages.some(message => message.includes('/seiza') && message.includes('88星座')));
    assert.ok(state.messages.some(message => message.includes('/uranai') && message.includes('12星座')));
    assert.ok(state.messages.some(message => message.includes('/omikuji')));
  } finally {
    await state.session.leave();
  }
});

test('ptk help に /seiza・/uranai・/omikuji を記載する', () => {
  const result = spawnSync(process.execPath, [new URL('../ptk.mjs', import.meta.url).pathname, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/seiza \[星座\].*88星座/u);
  assert.match(result.stdout, /\/uranai \[星座\].*12星座/u);
  assert.match(result.stdout, /\/omikuji\s+運勢/u);
});
