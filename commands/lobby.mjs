// ptk（引数なし）/ ptk lobby ── ロビーを TUI で表示する
import fs from 'fs';
import os from 'os';
import path from 'path';
import blessed from 'blessed';
import { openLobby } from '../lib/lobby.mjs';
import { padWidth, tuiText } from '../lib/text.mjs';
import { showRoom } from './roomview.mjs';
import { fixBlessedWidths } from '../lib/tui.mjs';

export async function runLobby({ profile, sound = true } = {}) {
  // ログで TUI が崩れないよう、console とエラーはファイルへ逃がす
  const logPath = path.join(os.tmpdir(), 'ptk-debug.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const fmt = args => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  process.on('uncaughtException', err => logStream.write('[UncaughtException] ' + err.stack + '\n'));
  process.on('unhandledRejection', reason => logStream.write('[UnhandledRejection] ' + reason + '\n'));
  console.log = (...args) => logStream.write(fmt(args) + '\n');
  console.error = (...args) => logStream.write('[ERROR] ' + fmt(args) + '\n');
  console.warn = (...args) => logStream.write('[WARN] ' + fmt(args) + '\n');

  // --- TUI Setup ---
  fixBlessedWidths();   // 絵文字を 2 マスと数えさせる（ずれて文字が食われるのを防ぐ）
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
    content: '  j/k: Move | Enter: 入る | r: Refresh | q: Quit', style: { fg: 'gray' }
  });

  // --- Logic ---
  let lobby = null;
  let shown = [];       // いま一覧に出している部屋（行番号 → 部屋）
  let current = null;   // 入っている部屋（showRoom の戻り値）。null ならロビーを見ている
  let note = '';        // 部屋から戻ったときのひとこと（満員だった等）

  function render() {
    if (!lobby || current) return;
    shown = lobby.rooms();
    const items = shown.map((r, i) => {
      const name = tuiText((r.bo ? '📡 ' : '') + (r.rn || '（名前のない部屋）'));
      const people = tuiText(r.people.map(p => p.emoji).join(''));
      return `  ${String(i + 1).padEnd(4)} ${padWidth(name, 25)} ${padWidth(tuiText(r.tag ? `#${r.tag}` : ''), 16)} ${r.people.length}人 ${people}`;
    });
    roomList.setItems(items.length ? items : ['  (現在通話中の部屋はありません)']);

    const { open, total } = lobby.relayStatus();
    statusBar.setContent(`  ⚡ [Nostr] ${open}/${total} relays  |  👀 ロビーの他の閲覧者 ${lobby.viewers()}  |  [ICE] STUN only${note ? '  |  ' + note : ''}`);
    screen.render();
  }

  async function start() {
    if (lobby) { const old = lobby; lobby = null; await old.leave(); }
    lobby = openLobby({ onChange: render, onPeer: render });
    render();
  }

  // 表示（リレー数・閲覧者数）を定期的に更新
  setInterval(render, 2000);

  // 部屋を選んで Enter → 部屋の画面へ。退出したらロビーへ戻る（ロビーの接続はつないだまま使い回す）
  roomList.on('select', async (_item, index) => {
    const r = shown[index];
    if (!r || current || !lobby) return;
    mainBox.hide();
    current = showRoom(screen, { target: { roomId: r.id, name: r.rn }, profile, lobby, sound });
    note = (await current.done) || '';
    current = null;
    mainBox.show();
    roomList.focus();
    render();
  });

  // 部屋にいるときの q は部屋の画面が受け持つ（退出してロビーへ）。Ctrl-C は退出してから終了する
  screen.key(['q'], () => { if (!current) process.exit(0); });
  screen.key(['C-c'], async () => {
    if (current) await current.close();
    await lobby?.leave();
    process.exit(0);
  });
  screen.key(['r'], () => {
    if (current) return;
    note = '';
    roomList.setItems(['  (再読み込み中...)']);
    screen.render();
    start();
  });

  screen.render();
  start();
}
