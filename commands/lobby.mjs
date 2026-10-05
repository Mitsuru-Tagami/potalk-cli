// ptk（引数なし）/ ptk lobby ── ロビーを TUI で表示する
import fs from 'fs';
import os from 'os';
import path from 'path';
import blessed from 'blessed';
import { openLobby } from '../lib/lobby.mjs';
import { padWidth } from '../lib/text.mjs';

export async function runLobby() {
  // ログで TUI が崩れないよう、console とエラーはファイルへ逃がす
  const logPath = path.join(os.tmpdir(), 'ptk-debug.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const fmt = args => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  process.on('uncaughtException', err => logStream.write('[UncaughtException] ' + err.stack + '\n'));
  process.on('unhandledRejection', reason => logStream.write('[UnhandledRejection] ' + reason + '\n'));
  console.log = (...args) => logStream.write(fmt(args) + '\n');
  console.error = (...args) => logStream.write('[ERROR] ' + fmt(args) + '\n');

  // --- TUI Setup ---
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,   // 日本語・絵文字の幅を正しく扱う
    title: 'POT-TALK CLI',
    cursor: { artificial: true, shape: 'line', blink: true, color: null }
  });

  const mainBox = blessed.box({
    top: 'center', left: 'center', width: '100%', height: '100%',
    label: ' POT-TALK CLI v0.1.0 ─── [Mode: LOBBY] ',
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } }
  });
  screen.append(mainBox);

  blessed.box({
    parent: mainBox, top: 1, left: 1, width: '100%-4', height: 1,
    content: '  #    ROOM NAME                 TAGS             USERS',
    style: { fg: 'green', bold: true }
  });
  blessed.line({ parent: mainBox, top: 2, left: 1, width: '100%-4', orientation: 'horizontal', style: { fg: 'gray' } });

  const roomList = blessed.list({
    parent: mainBox,
    top: 3, left: 1, width: '100%-4', height: '100%-9',
    keys: true, vi: true, mouse: true,
    items: ['  (部屋情報を検索中...)'],
    style: { selected: { bg: 'cyan', fg: 'black', bold: true } }
  });
  roomList.focus();

  blessed.line({ parent: mainBox, bottom: 3, left: 0, width: '100%-2', orientation: 'horizontal', style: { fg: 'gray' } });
  const statusBar = blessed.box({
    parent: mainBox, bottom: 2, left: 0, width: '100%-2', height: 1,
    content: '  ⚡ [Nostr] Connecting...', style: { fg: 'yellow' }
  });
  blessed.box({
    parent: mainBox, bottom: 1, left: 0, width: '100%-2', height: 1,
    content: '  j/k: Move | r: Refresh | q: Quit', style: { fg: 'gray' }
  });

  // --- Logic ---
  let lobby = null;

  function render() {
    if (!lobby) return;
    const items = lobby.rooms().map((r, i) => {
      const name = (r.bo ? '📡 ' : '') + (r.rn || '（名前のない部屋）');
      const people = r.people.map(p => p.emoji).join('');
      return `  ${String(i + 1).padEnd(4)} ${padWidth(name, 25)} ${padWidth(r.tag ? `#${r.tag}` : '', 16)} ${r.people.length}人 ${people}`;
    });
    roomList.setItems(items.length ? items : ['  (現在通話中の部屋はありません)']);

    const { open, total } = lobby.relayStatus();
    statusBar.setContent(`  ⚡ [Nostr] ${open}/${total} relays  |  👀 ロビーの他の閲覧者 ${lobby.viewers()}  |  [ICE] STUN only`);
    screen.render();
  }

  async function start() {
    if (lobby) { const old = lobby; lobby = null; await old.leave(); }
    lobby = openLobby({ onChange: render, onPeer: render });
    render();
  }

  // 表示（リレー数・閲覧者数）を定期的に更新
  setInterval(render, 2000);

  screen.key(['q', 'C-c'], () => process.exit(0));
  screen.key(['r'], () => {
    roomList.setItems(['  (再読み込み中...)']);
    screen.render();
    start();
  });

  screen.render();
  start();
}
