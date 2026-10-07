// ptk（引数なし）/ ptk lobby ── ロビーを TUI で表示する
import fs from 'fs';
import os from 'os';
import path from 'path';
import blessed from 'blessed';
import { openLobby, matchRoom } from '../lib/lobby.mjs';
import { padWidth, tuiText } from '../lib/text.mjs';
import { showRoom } from './roomview.mjs';
import { fixBlessedWidths } from '../lib/tui.mjs';

export async function runLobby({ profile, notice = '', sound = true } = {}) {
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
    label: tuiText(` POT-TALK CLI v0.1.0 ─── [Mode: LOBBY] ─── あなた：${profile.emoji}${profile.name}（変えるには ptk --name 名前） `),
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
  const helpLine = blessed.box({
    parent: mainBox, bottom: 1, left: 0, width: '100%-2', height: 1,
    content: '  j/k: Move | Enter: 入る | /: 絞り込み | r: Refresh | q: Quit', style: { fg: 'gray' }
  });
  // 絞り込みの入力欄（/ で開く。Vim の検索と同じ感覚）。キーの説明の行に重ねて出す
  const searchBox = blessed.textbox({
    parent: mainBox, bottom: 1, left: 2, width: '100%-6', height: 1,
    inputOnFocus: true, hidden: true, style: { fg: 'white' }
  });

  // --- Logic ---
  let lobby = null;
  let shown = [];       // いま一覧に出している部屋（行番号 → 部屋）
  let current = null;   // 入っている部屋（showRoom の戻り値）。null ならロビーを見ている
  let note = notice;    // 画面の頭に出すひとこと（名乗りを覚えた・部屋が満員だった等）
  let filter = '';      // 絞り込みの文字（空なら全部）

  function render() {
    if (!lobby || current) return;
    shown = lobby.rooms().filter(r => matchRoom(r, filter));
    const items = shown.map((r, i) => {
      const name = tuiText((r.bo ? '📡 ' : '') + (r.rn || '（名前のない部屋）'));
      const people = tuiText(r.people.map(p => p.emoji).join(''));
      return `  ${String(i + 1).padEnd(4)} ${padWidth(name, 25)} ${padWidth(tuiText(r.tag ? `#${r.tag}` : ''), 16)} ${r.people.length}人 ${people}`;
    });
    roomList.setItems(items.length ? items : [filter ? tuiText(`  (「${filter}」に合う部屋はありません。Esc で解除)`) : '  (現在通話中の部屋はありません)']);

    const { open, total } = lobby.relayStatus();
    // 絞り込み中と、部屋から戻ったときのひとことは、切れないよう行の頭に出す
    const head = [filter && tuiText(`🔍 「${filter}」（Esc で解除）`), note].filter(Boolean).map(s => s + '  |  ').join('');
    statusBar.setContent(`  ${head}⚡ [Nostr] ${open}/${total} relays  |  👀 ロビーの他の閲覧者 ${lobby.viewers()}  |  [ICE] STUN only`);
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

  // ── 絞り込み ── / で入力欄を開き、打つたびに一覧を絞る。Enter で確定（一覧へ戻る）、Esc で解除
  const searching = () => screen.focused === searchBox;
  const closeSearch = () => { searchBox.hide(); helpLine.show(); roomList.focus(); render(); };
  screen.key(['/'], () => {
    if (current || searching()) return;
    helpLine.hide(); searchBox.show();
    searchBox.setValue(filter);
    searchBox.focus();
    screen.render();
  });
  // 打った文字は keypress のあとで value に入るので、次の周回で読む
  searchBox.on('keypress', () => setImmediate(() => {
    if (!searching()) return;
    filter = searchBox.getValue().replace(/^\//, '');
    roomList.select(0);
    render();
  }));
  searchBox.on('submit', value => { filter = String(value || '').replace(/^\//, '').trim(); closeSearch(); });
  searchBox.on('cancel', () => { filter = ''; closeSearch(); });
  screen.key(['escape'], () => { if (!current && !searching() && filter) { filter = ''; render(); } });

  // 部屋にいるときの q は部屋の画面が受け持つ（退出してロビーへ）。Ctrl-C は退出してから終了する。
  // 絞り込みの入力中は q も r もただの文字
  screen.key(['q'], () => { if (!current && !searching()) process.exit(0); });
  // 部屋にいれば退出を知らせてから終わる。Ctrl-C のほか、ターミナルのウィンドウを閉じた（SIGHUP）・
  // 終了を頼まれた（SIGTERM）ときも同じ（知らせずに消えると、ほかの人のロビーに部屋がしばらく残る）
  let quitting = false;
  const quitApp = async () => {
    if (quitting) return; quitting = true;
    setTimeout(() => process.exit(0), 4000).unref();   // 何かで詰まっても必ず終わる
    if (current) await current.close();
    await lobby?.leave();
    process.exit(0);
  };
  screen.key(['C-c'], quitApp);
  for (const sig of ['SIGHUP', 'SIGTERM']) process.on(sig, quitApp);
  screen.key(['r'], () => {
    if (current || searching()) return;
    note = '';
    roomList.setItems(['  (再読み込み中...)']);
    screen.render();
    start();
  });

  screen.render();
  start();
}
