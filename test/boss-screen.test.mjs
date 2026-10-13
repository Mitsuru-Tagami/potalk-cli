import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import { showRoom } from '../commands/roomview.mjs';
import { KONAMI_KEY_SEQUENCE_LABEL, KONAMI_SEQUENCE } from '../lib/easter-egg.mjs';

function makeRoomView() {
  const inputStream = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input: inputStream, output, terminal: 'xterm', smartCSR: false });
  screen.program.cols = 80;
  screen.program.rows = 24;

  let callbacks;
  let muteToggles = 0;
  let leaves = 0;
  const sent = [];
  const session = {
    room: { bcast: false, canTalk: false },
    speaker: null,
    members: () => [],
    label: () => 'テスト部屋',
    micOn: false,
    toggleMute() { muteToggles++; },
    toggleTalk() {},
    command(line) {
      if (line.trim() !== '/boss') return false;
      callbacks.onBoss();
      return true;
    },
    say(text) { sent.push(text); },
    async leave() { leaves++; }
  };
  const view = showRoom(screen, {
    target: { roomId: 'test-room', name: 'テスト部屋' },
    profile: { name: 'CLI', emoji: '💻' },
    lobby: {}, sound: false,
    enterRoomImpl: options => { callbacks = options; return session; }
  });
  const frame = screen.children[0];
  return {
    screen, view, callbacks: () => callbacks, session, frame,
    input: frame.children.find(element => element.type === 'textbox'),
    log: frame.children.find(element => element.type === 'log'),
    get muteToggles() { return muteToggles; },
    get leaves() { return leaves; },
    sent
  };
}

function pressKey(screen, name, ch = ['escape', 'f12', 'enter'].includes(name) ? '' : name) {
  screen.program.emit('keypress', ch, { name, full: name });
}

async function closeRoom(state) {
  await state.view.close();
  await state.view.done;
  state.screen.destroy();
}

test('/boss画面はマウスでは閉じず、任意のキーで戻り、通話操作に触れない', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    state.callbacks().onBoss();
    assert.equal(state.screen.grabKeys, true);
    assert.equal(state.screen.children.length, initialChildren + 1);
    const overlay = state.screen.children.at(-1);
    assert.ok(state.input.lpos, 'the underlying input should have a rendered mouse target');

    const mouse = { x: state.input.lpos.xi, y: state.input.lpos.yi };
    state.screen.program.emit('mouse', { action: 'mousedown', ...mouse });
    state.screen.program.emit('mouse', { action: 'mouseup', ...mouse });
    assert.equal(state.screen.grabKeys, true, 'mouse input must leave the decoy screen active');
    assert.equal(state.screen.children.includes(overlay), true);
    assert.equal(state.screen.focused, overlay, 'mouse input must not focus the hidden room UI');

    pressKey(state.screen, 'm');
    assert.equal(state.screen.grabKeys, false, 'the next keyboard key restores normal controls');
    assert.equal(state.screen.children.includes(overlay), false);
    assert.equal(state.muteToggles, 0, 'the exit key must not trigger the hidden room shortcut');
    assert.equal(state.leaves, 0, 'the room session stays connected');
  } finally {
    await closeRoom(state);
  }
});

test('F12は通話画面で起動し、入力中は安全で、bは通常入力のまま', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    pressKey(state.screen, 'b');
    assert.equal(state.screen.children.length, initialChildren, 'b must not open the boss screen');

    pressKey(state.screen, 'i');
    await new Promise(resolve => setImmediate(resolve));
    pressKey(state.screen, 'b');
    assert.equal(state.screen.children.length, initialChildren);
    assert.equal(state.input.getValue(), 'b');
    pressKey(state.screen, 'f12');
    assert.equal(state.screen.children.length, initialChildren, 'F12 must not steal an input field');
    assert.equal(state.input.getValue(), 'b');

    pressKey(state.screen, 'escape');
    assert.equal(state.input.getValue(), '', 'Escape still cancels the input');
    assert.equal(state.screen.focused, state.log);
    assert.equal(state.screen.children.length, initialChildren);

    pressKey(state.screen, 'f12');
    assert.equal(state.screen.grabKeys, true);
    assert.equal(state.screen.children.length, initialChildren + 1);

    pressKey(state.screen, 'f12');
    assert.equal(state.screen.grabKeys, false, 'F12 returns without reopening on the same keypress');
    assert.equal(state.screen.children.length, initialChildren);
  } finally {
    await closeRoom(state);
  }
});

test('/boss入力は一時画面を開き、任意のキーで部屋へ戻る', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    pressKey(state.screen, 'i');
    await new Promise(resolve => setImmediate(resolve));
    state.input.setValue('/boss');
    pressKey(state.screen, 'enter');
    assert.equal(state.screen.grabKeys, true);
    assert.equal(state.screen.children.length, initialChildren + 1);
    assert.deepEqual(state.sent, [], '/boss is a local screen switch, not a chat message');

    pressKey(state.screen, 'x');
    assert.equal(state.screen.grabKeys, false);
    assert.equal(state.screen.children.length, initialChildren);
    assert.equal(state.screen.focused, state.log);
  } finally {
    await closeRoom(state);
  }
});

test('単独Escapeと間隔の長い二回は起動せず、短時間の二回で起動する', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    pressKey(state.screen, 'escape');
    assert.equal(state.screen.children.length, initialChildren, 'one Escape must not launch the decoy screen');

    await new Promise(resolve => setTimeout(resolve, 380));
    pressKey(state.screen, 'escape');
    assert.equal(state.screen.children.length, initialChildren, 'the first press after the window starts a new pair');
    pressKey(state.screen, 'x');
    pressKey(state.screen, 'escape');
    assert.equal(state.screen.children.length, initialChildren, 'a non-Escape key breaks the pair');
    pressKey(state.screen, 'escape');
    assert.equal(state.screen.grabKeys, true);
    assert.equal(state.screen.children.length, initialChildren + 1);
  } finally {
    await closeRoom(state);
  }
});

test('入力欄のEscapeキャンセルは二連続判定に持ち越さない', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    pressKey(state.screen, 'escape');
    assert.equal(state.screen.children.length, initialChildren);
    pressKey(state.screen, 'i');
    await new Promise(resolve => setImmediate(resolve));
    state.input.setValue('draft');
    state.screen.render();

    pressKey(state.screen, 'escape');
    assert.equal(state.input.getValue(), '');
    assert.equal(state.screen.focused, state.log);
    assert.equal(state.screen.children.length, initialChildren);

    pressKey(state.screen, 'escape');
    assert.equal(state.screen.children.length, initialChildren, 'Escape in the input must not count toward a pair');
    pressKey(state.screen, 'escape');
    assert.equal(state.screen.grabKeys, true, 'only the two post-cancel presses form the pair');
    assert.equal(state.screen.children.length, initialChildren + 1);
  } finally {
    await closeRoom(state);
  }
});

test('コナミ配列・チャット文字列・/konamiは部屋内で演出を起動しない', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    for (const name of KONAMI_SEQUENCE) pressKey(state.screen, name);
    assert.equal(state.screen.grabKeys, false);
    assert.equal(state.screen.children.length, initialChildren);

    pressKey(state.screen, 'i');
    await new Promise(resolve => setImmediate(resolve));
    state.input.setValue(KONAMI_KEY_SEQUENCE_LABEL);
    pressKey(state.screen, 'enter');
    assert.deepEqual(state.sent, [KONAMI_KEY_SEQUENCE_LABEL]);
    assert.equal(state.screen.children.length, initialChildren);

    pressKey(state.screen, 'i');
    await new Promise(resolve => setImmediate(resolve));
    state.input.setValue('/konami');
    pressKey(state.screen, 'enter');
    assert.deepEqual(state.sent, [KONAMI_KEY_SEQUENCE_LABEL]);
    assert.equal(state.screen.children.length, initialChildren);
  } finally {
    await closeRoom(state);
  }
});
