import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import { showRoom } from '../commands/roomview.mjs';

function makeRoomView() {
  const inputStream = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input: inputStream, output, terminal: 'xterm', smartCSR: false });
  screen.program.cols = 80;
  screen.program.rows = 24;

  let callbacks;
  let muteToggles = 0;
  let leaves = 0;
  const session = {
    room: { bcast: false, canTalk: false },
    speaker: null,
    members: () => [],
    label: () => 'テスト部屋',
    micOn: false,
    toggleMute() { muteToggles++; },
    toggleTalk() {},
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
    get leaves() { return leaves; }
  };
}

function pressKey(screen, name, ch = name === 'escape' ? '' : name) {
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

test('bは通話画面で起動し、入力欄では入力文字になる', async () => {
  const state = makeRoomView();
  try {
    const initialChildren = state.screen.children.length;
    pressKey(state.screen, 'i');
    await new Promise(resolve => setImmediate(resolve));
    pressKey(state.screen, 'b');
    assert.equal(state.screen.children.length, initialChildren);
    assert.equal(state.input.getValue(), 'b');

    pressKey(state.screen, 'escape');
    assert.equal(state.input.getValue(), '', 'Escape still cancels the input');
    assert.equal(state.screen.focused, state.log);
    assert.equal(state.screen.children.length, initialChildren);

    pressKey(state.screen, 'b');
    assert.equal(state.screen.grabKeys, true);
    assert.equal(state.screen.children.length, initialChildren + 1);
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
