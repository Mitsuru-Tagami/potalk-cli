import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import { bindLobbyBossScreenShortcut } from '../commands/lobby.mjs';
import { startBossScreen } from '../commands/boss-screen.mjs';

function makeScreen() {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input: new PassThrough(), output, terminal: 'xterm', smartCSR: false });
  screen.program.cols = 80;
  screen.program.rows = 24;
  return screen;
}

function pressKey(screen, name) {
  screen.program.emit('keypress', name === 'f12' ? '' : name, { name, full: name });
}

test('ロビーではF12で一時画面を開閉でき、検索中・入室中は起動しない', () => {
  const screen = makeScreen();
  let inRoom = false;
  let searching = false;
  let easterEggActive = false;
  let openings = 0;
  let bossScreen = null;
  const unbind = bindLobbyBossScreenShortcut(screen, {
    isRoomActive: () => inRoom,
    isSearching: () => searching,
    isBossScreenActive: () => !!bossScreen?.active,
    isEasterEggActive: () => easterEggActive,
    onOpen: () => {
      if (bossScreen?.active) return;
      openings++;
      bossScreen = startBossScreen(screen, { onClose: () => { bossScreen = null; } });
    }
  });

  try {
    pressKey(screen, 'b');
    assert.equal(openings, 0, 'b is not a shortcut in the lobby');

    pressKey(screen, 'f12');
    assert.equal(openings, 1);
    assert.equal(bossScreen.active, true);
    assert.equal(screen.grabKeys, true);

    pressKey(screen, 'f12');
    assert.equal(bossScreen, null, 'F12 returns to the lobby without reopening');
    assert.equal(screen.grabKeys, false);

    searching = true;
    pressKey(screen, 'f12');
    assert.equal(openings, 1, 'search input keeps its focus and F12 does not cover it');
    searching = false;

    inRoom = true;
    pressKey(screen, 'f12');
    assert.equal(openings, 1, 'the room screen owns F12 while a room is active');
    inRoom = false;

    pressKey(screen, 'f12');
    assert.equal(openings, 2, 'F12 works again after returning to the lobby');
    assert.equal(bossScreen.active, true);
    bossScreen.close({ render: false });

    easterEggActive = true;
    pressKey(screen, 'f12');
    assert.equal(openings, 2, 'F12 does not stack over the staff-roll overlay');
    easterEggActive = false;
    pressKey(screen, 'f12');
    assert.equal(openings, 3, 'F12 works again after the staff-roll overlay closes');
    assert.equal(bossScreen.active, true);
  } finally {
    unbind();
    bossScreen?.close({ render: false });
    screen.destroy();
  }
});

test('--bossの起動時表示は一度だけ画面を開き、任意のキーでロビーへ戻る', () => {
  const screen = makeScreen();
  let openings = 0;
  let bossScreen = null;
  const unbind = bindLobbyBossScreenShortcut(screen, {
    launchOnStart: true,
    isBossScreenActive: () => !!bossScreen?.active,
    onOpen: () => {
      openings++;
      bossScreen = startBossScreen(screen, { onClose: () => { bossScreen = null; } });
    }
  });

  try {
    assert.equal(openings, 1);
    assert.equal(bossScreen.active, true);
    pressKey(screen, 'x');
    assert.equal(bossScreen, null);
    assert.equal(openings, 1, 'the dismissing key must not also reopen the screen');
  } finally {
    unbind();
    bossScreen?.close({ render: false });
    screen.destroy();
  }
});
