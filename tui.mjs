import blessed from 'blessed';

const screen = blessed.screen({
  smartCSR: true,
  title: 'POT-TALK CLI'
});

// メインのコンテナ (枠線付き)
const mainBox = blessed.box({
  top: 'center',
  left: 'center',
  width: '100%',
  height: '100%',
  label: ' 🫖 POT-TALK CLI v0.1.0 ─────────────────────────────────── [Mode: LOBBY] ',
  border: { type: 'line' },
  style: { border: { fg: 'cyan' } }
});
screen.append(mainBox);

// ヘッダー行 (カラム名)
const header = blessed.box({
  parent: mainBox,
  top: 1,
  left: 1,
  width: '100%-4',
  height: 1,
  content: '  ID          ROOM NAME                 TAGS           USERS   STATUS',
  style: { fg: 'green', bold: true }
});

// 区切り線
const separator = blessed.box({
  parent: mainBox,
  top: 2,
  left: 1,
  width: '100%-4',
  height: 1,
  content: ' ────────────────────────────────────────────────────────────────────────────',
  style: { fg: 'gray' }
});

// 部屋リスト
const roomList = blessed.list({
  parent: mainBox,
  top: 3,
  left: 1,
  width: '100%-4',
  height: '100%-11',
  keys: true,
  vi: true, // j, k での移動を有効化
  mouse: true,
  items: [
    '  [1] x8j2    もくもく開発部屋          #vim #rust     [4/8]   ☁  ONLINE',
    '  [2] a9f4    雑談・作業用              #coffee        [2/8]   ☁  ONLINE',
    '  [3] k3m1    【配信】Rust勉強会        #live #host    [12/15] ☁  STREAMING',
    '  [4] q7r9    深夜のLinux語り場         #kernel        [6/8]   ↔  P2P(STUN)'
  ],
  style: {
    selected: { bg: 'cyan', fg: 'black', bold: true }
  }
});

roomList.focus();

// ステータスバー
const statusBar = blessed.box({
  parent: mainBox,
  bottom: 4,
  left: 0,
  width: '100%-2',
  height: 1,
  content: '  ⚡ [Nostr] Connected (7/7 relays)  |  [TURN] Key acquired successfully',
  style: { fg: 'yellow' }
});

// コマンド入力エリア
const commandLine = blessed.box({
  parent: mainBox,
  bottom: 2,
  left: 0,
  width: '100%-2',
  height: 1,
  content: ' :connect 1 ─────────────────────────────────────────────────────────────────',
  style: { fg: 'white' }
});

// フッター (操作説明)
const footer = blessed.box({
  parent: mainBox,
  bottom: 1,
  left: 0,
  width: '100%-2',
  height: 1,
  content: '  j/k: Move | enter: Join | r: Refresh | q: Quit | :[command]',
  style: { fg: 'gray' }
});

// 区切り線 (下部用)
const sepBottom1 = blessed.box({
  parent: mainBox,
  bottom: 5,
  left: 0,
  width: '100%-2',
  height: 1,
  content: '├──────────────────────────────────────────────────────────────────────────────┤'
});
const sepBottom2 = blessed.box({
  parent: mainBox,
  bottom: 3,
  left: 0,
  width: '100%-2',
  height: 1,
  content: '├──────────────────────────────────────────────────────────────────────────────┤'
});

// q で終了するショートカット
screen.key(['q', 'C-c'], function(ch, key) {
  return process.exit(0);
});

screen.render();
