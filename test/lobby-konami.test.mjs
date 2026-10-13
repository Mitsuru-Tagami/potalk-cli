import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import { bindLobbyKonamiSequence } from '../commands/lobby.mjs';
import { KONAMI_SEQUENCE } from '../lib/easter-egg.mjs';

function makeScreen() {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input: new PassThrough(), output, terminal: 'xterm', smartCSR: false });
  screen.program.cols = 80;
  screen.program.rows = 24;
  return screen;
}

function pressKey(screen, name) {
  screen.program.emit('keypress', ['up', 'down', 'left', 'right'].includes(name) ? '' : name, { name, full: name });
}

function pressSequence(screen, sequence = KONAMI_SEQUENCE) {
  for (const name of sequence) pressKey(screen, name);
}

test('ロビーの実キー列を一度だけ検知し、誤入力では途中状態を破棄する', () => {
  const screen = makeScreen();
  let openings = 0;
  const unbind = bindLobbyKonamiSequence(screen, { onOpen: () => { openings++; } });
  try {
    pressKey(screen, 'up');
    pressKey(screen, 'right');
    pressSequence(screen);
    assert.equal(openings, 1);
    pressSequence(screen);
    assert.equal(openings, 2);
  } finally {
    unbind();
    screen.destroy();
  }
});

test('検索中・入室中・別画面表示中は検知せず、無効期間の途中入力も持ち越さない', () => {
  const screen = makeScreen();
  let openings = 0;
  let searching = false;
  let inRoom = false;
  let bossActive = false;
  const unbind = bindLobbyKonamiSequence(screen, {
    onOpen: () => { openings++; },
    isSearching: () => searching,
    isRoomActive: () => inRoom,
    isBossScreenActive: () => bossActive
  });
  try {
    searching = true;
    pressSequence(screen, KONAMI_SEQUENCE.slice(0, 5));
    searching = false;
    pressSequence(screen, KONAMI_SEQUENCE.slice(5));
    assert.equal(openings, 0, '検索中に始めた配列は検索後へ持ち越さない');

    inRoom = true;
    pressSequence(screen);
    inRoom = false;
    assert.equal(openings, 0);

    bossActive = true;
    pressSequence(screen);
    bossActive = false;
    assert.equal(openings, 0);

    pressSequence(screen);
    assert.equal(openings, 1);
  } finally {
    unbind();
    screen.destroy();
  }
});

test('起動時の一時テストオプションはコールバックを直接一度起動する', () => {
  const screen = makeScreen();
  let openings = 0;
  const unbind = bindLobbyKonamiSequence(screen, {
    onOpen: () => { openings++; },
    launchOnStart: true
  });
  try {
    assert.equal(openings, 1);
    pressSequence(screen);
    assert.equal(openings, 2, 'オーバーレイ終了後に通常のキー列も使える');
  } finally {
    unbind();
    screen.destroy();
  }
});

test('キー検知リスナーは上下矢印によるBlessedリスト移動を横取りしない', () => {
  const screen = makeScreen();
  const list = blessed.list({ parent: screen, keys: true, items: ['first', 'second', 'third'] });
  list.focus();
  screen.render();
  const unbind = bindLobbyKonamiSequence(screen, { onOpen() {} });
  try {
    const before = list.selected;
    pressKey(screen, 'down');
    assert.notEqual(list.selected, before);
    assert.equal(list.selected, 1);
  } finally {
    unbind();
    screen.destroy();
  }
});
