import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { enterRoom } from '../lib/session.mjs';
import { allBundledPackOptions } from './helpers/packs.mjs';
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
    ...allBundledPackOptions,
    createTtsImpl: () => ({ speak: text => { spoken.push(text); return true; }, close() {} })
  });
  return { session, room, messages, received, spoken };
}

test('/waka と /haiku は作者・出典付きの一行を送信し、同じ本文をTTSへ渡す', async () => {
  const state = makeSession();
  try {
    for (const [command, citation] of [['/waka', '〔古今集・国文研〕'], ['/haiku', '〔松山市・子規俳句〕']]) {
      assert.equal(state.session.command(command), true);
      const message = state.room.sent.at(-1);
      assert.ok(message, `${command} should send one message`);
      assert.ok(message.endsWith(citation), message);
      assert.match(message, / — .+〔/u);
      assert.equal(/[\r\n\u2028\u2029]/u.test(message), false, 'chat body must be one line');
      assert.ok([...message].length <= CHAT_MAX, `${[...message].length} > ${CHAT_MAX}: ${message}`);
      assert.equal(state.spoken.at(-1), message);
    }
    assert.equal(state.room.sent.length, 2);
    assert.deepEqual(state.received, [], 'locally sent poems must not be treated as received JSONL events');
    assert.ok(state.messages.some(message => message.includes('（あなた）：')));
  } finally {
    await state.session.leave();
  }
});

test('/waka と /haiku は引数を受け付けず、不正時は送信・TTSしない', async () => {
  const state = makeSession();
  try {
    assert.equal(state.session.command('/waka extra'), true);
    assert.equal(state.session.command('/haiku 2'), true);
    assert.deepEqual(state.room.sent, []);
    assert.deepEqual(state.spoken, []);
    assert.ok(state.messages.some(message => message.includes('使用方法：/waka')));
    assert.ok(state.messages.some(message => message.includes('使用方法：/haiku')));
  } finally {
    await state.session.leave();
  }
});

test('/waka と /haiku は送信制限中もローカル表示し、TTSへ渡す', async () => {
  const state = makeSession({ room: fakeSessionRoom({ sendOk: false }) });
  try {
    state.session.command('/waka');
    assert.equal(state.room.sent.length, 1);
    assert.equal(state.spoken.length, 1);
    assert.ok(state.messages.some(message => message.includes('チャットに送信できませんでした')));
    assert.deepEqual(state.received, []);
  } finally {
    await state.session.leave();
  }
});

test('/help は /waka と /haiku を案内する', async () => {
  const state = makeSession();
  try {
    assert.equal(state.session.command('/help'), true);
    assert.ok(state.messages.some(message => message.includes('/waka')));
    assert.ok(state.messages.some(message => message.includes('/haiku')));
  } finally {
    await state.session.leave();
  }
});

test('ptk help に /waka と /haiku を記載する', () => {
  const result = spawnSync(process.execPath, [new URL('../ptk.mjs', import.meta.url).pathname, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/waka\s+古今和歌集/u);
  assert.match(result.stdout, /\/haiku\s+正岡子規/u);
});
