import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import { showRoom } from '../commands/roomview.mjs';

test('/boss画面はマウスでは閉じず、任意のキーで戻り、通話操作に触れない', async () => {
  const input = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input, output, terminal: 'xterm', smartCSR: false });
  screen.program.cols = 80;
  screen.program.rows = 24;

  let options;
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
    enterRoomImpl: callbacks => { options = callbacks; return session; }
  });

  try {
    const overlayCount = screen.children.length;
    options.onBoss();
    assert.equal(screen.grabKeys, true);
    assert.equal(screen.children.length, overlayCount + 1);
    const overlay = screen.children.at(-1);
    const hiddenInput = screen.children[0].children.find(element => element.type === 'textbox');
    assert.ok(hiddenInput?.lpos, 'the underlying input should have a rendered mouse target');

    const mouse = { x: hiddenInput.lpos.xi, y: hiddenInput.lpos.yi };
    screen.program.emit('mouse', { action: 'mousedown', ...mouse });
    screen.program.emit('mouse', { action: 'mouseup', ...mouse });
    assert.equal(screen.grabKeys, true, 'mouse input must leave the decoy screen active');
    assert.equal(screen.children.includes(overlay), true);
    assert.equal(screen.focused, overlay, 'mouse input must not focus the hidden room UI');

    screen.program.emit('keypress', 'm', { name: 'm', full: 'm' });
    assert.equal(screen.grabKeys, false, 'the next keyboard key restores normal controls');
    assert.equal(screen.children.includes(overlay), false);
    assert.equal(muteToggles, 0, 'the exit key must not trigger the hidden room shortcut');
    assert.equal(leaves, 0, 'the room session stays connected');
  } finally {
    await view.close();
    await view.done;
    screen.destroy();
  }
});
