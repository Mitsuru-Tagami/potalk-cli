import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { enterRoom } from '../lib/session.mjs';
import { completeRoomCommand, roomCommandMatches } from '../lib/commands.mjs';
import { KONAMI_KEY_SEQUENCE_LABEL } from '../lib/easter-egg.mjs';

function makeSession({ onBoss = null } = {}) {
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
    onText: message => messages.push(message), onBoss,
    openRoomImpl: () => room,
    createTtsImpl: () => ({ speak() {}, close() {} })
  });
  return { session, messages, sent };
}

test('/bossはTab補完される', () => {
  assert.deepEqual(roomCommandMatches('/bo'), ['/boss']);
  assert.deepEqual(completeRoomCommand('/boss'), [['/boss'], '/boss']);
});

test('/bossはTUIコールバックだけを呼び、通話チャットは送信しない', async () => {
  let entries = 0;
  const state = makeSession({ onBoss: () => { entries++; } });
  try {
    assert.equal(state.session.command('/boss'), true);
    assert.equal(entries, 1);
    assert.deepEqual(state.sent, []);
  } finally {
    await state.session.leave();
  }
});

test('/bossは行表示ではTUI専用と案内し、引数付きなら画面を開かない', async () => {
  let entries = 0;
  const state = makeSession({ onBoss: () => { entries++; } });
  try {
    assert.equal(state.session.command('/boss extra'), true);
    assert.equal(entries, 0);
    assert.match(state.messages.at(-1), /使用方法：\/boss/u);

    const lineMode = makeSession();
    try {
      assert.equal(lineMode.session.command('/boss'), true);
      assert.match(lineMode.messages.at(-1), /TUI.*のみ/u);
    } finally {
      await lineMode.session.leave();
    }
  } finally {
    await state.session.leave();
  }
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

test('/helpとptk helpに/bossの説明がある', async () => {
  const state = makeSession();
  try {
    state.session.command('/help');
    assert.ok(state.messages.some(message => /\/boss.*TUIのみ.*F12/u.test(message)));
  } finally {
    await state.session.leave();
  }

  const result = spawnSync(process.execPath, [new URL('../ptk.mjs', import.meta.url).pathname, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/boss.*F12.*任意のキーで戻る/u);
});
