import * as wrtc from 'node-datachannel/polyfill';
import WebSocket from 'ws';
import crypto from 'crypto';
import fetch from 'node-fetch';
import blessed from 'blessed';
import { joinRoom } from 'trystero/nostr';

// Polyfills for trystero
Object.assign(globalThis, wrtc);
class SafeWebSocket extends WebSocket {
  constructor(...args) {
    super(...args);
    this.on('error', (err) => {
      // 内部のエラーを握りつぶす
    });
  }
}
globalThis.WebSocket = SafeWebSocket;
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.location) globalThis.location = { protocol: 'https:' };
if (!globalThis.fetch) globalThis.fetch = fetch;

import fs from 'fs';

// エラーやログでTUIが崩れないように退避しつつ、debug.logに出力する
const logStream = fs.createWriteStream('debug.log', { flags: 'a' });
process.on('uncaughtException', (err) => {
  logStream.write('[UncaughtException] ' + err.stack + '\n');
});
process.on('unhandledRejection', (reason) => {
  logStream.write('[UnhandledRejection] ' + reason + '\n');
});
const origLog = console.log;
const origError = console.error;
console.log = (...args) => {
  logStream.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
};
console.error = (...args) => {
  logStream.write('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
};

const TRYSTERO_BASE = {
  appId: 'potalk.app',
  relayConfig: {
    urls: [
      'wss://relay.primal.net', 
      'wss://purplerelay.com', 
      'wss://bucket.coracle.social', 
      'wss://yabu.me/v2',
      'wss://x.kojira.io', 
      'wss://relay.notoshi.win', 
      'wss://relay.mostr.pub'
    ],
    redundancy: 3
  }
};
const TURN_WORKER_URL = 'https://pot-turn.itsuma-kuramoto.workers.dev/';
const LOBBY_ROOM = '__lobby__';
const STALE_MS = 30000;

// データストア
const presences = new Map();
let lobby = null;

// --- TUI Setup ---
const screen = blessed.screen({
  smartCSR: true,
  unicode: true, // これがないと日本語や絵文字が「?」に化ける
  title: 'POT-TALK CLI',
  cursor: {
    artificial: true,
    shape: 'line',
    blink: true,
    color: null
  }
});

const mainBox = blessed.box({
  top: 'center',
  left: 'center',
  width: '100%',
  height: '100%',
  label: ' POT-TALK CLI v0.1.0 ─────────────────────────────────── [Mode: LOBBY] ',
  border: { type: 'line' },
  style: { border: { fg: 'cyan' } }
});
screen.append(mainBox);

const header = blessed.box({
  parent: mainBox,
  top: 1, left: 1, width: '100%-4', height: 1,
  content: '  ID       ROOM NAME                 TAGS           USERS   STATUS',
  style: { fg: 'green', bold: true }
});

const separator = blessed.box({
  parent: mainBox,
  top: 2, left: 1, width: '100%-4', height: 1,
  content: ' ────────────────────────────────────────────────────────────────────────────',
  style: { fg: 'gray' }
});

const roomList = blessed.list({
  parent: mainBox,
  top: 3, left: 1, width: '100%-4', height: '100%-11',
  keys: true, vi: true, mouse: true,
  items: ['  (部屋情報を検索中...)'],
  style: { selected: { bg: 'cyan', fg: 'black', bold: true } }
});
roomList.focus();

const statusBar = blessed.box({
  parent: mainBox,
  bottom: 4, left: 0, width: '100%-2', height: 1,
  content: `  ⚡ [Nostr] Connecting...  |  [TURN] Fetching key...`,
  style: { fg: 'yellow' }
});

const commandLine = blessed.box({
  parent: mainBox,
  bottom: 2, left: 0, width: '100%-2', height: 1,
  content: ' : ──────────────────────────────────────────────────────────────────────────',
  style: { fg: 'white' }
});

const footer = blessed.box({
  parent: mainBox,
  bottom: 1, left: 0, width: '100%-2', height: 1,
  content: '  j/k: Move | enter: Join | r: Refresh | q: Quit | :[command]',
  style: { fg: 'gray' }
});

blessed.box({
  parent: mainBox, bottom: 5, left: 0, width: '100%-2', height: 1,
  content: '├──────────────────────────────────────────────────────────────────────────────┤'
});
blessed.box({
  parent: mainBox, bottom: 3, left: 0, width: '100%-2', height: 1,
  content: '├──────────────────────────────────────────────────────────────────────────────┤'
});

// --- Logic ---
function stringPad(str, len) {
  const s = String(str || '');
  if (s.length >= len) return s.substring(0, len);
  return s + ' '.repeat(len - s.length);
}

function renderLobby() {
  const now = Date.now();
  // 古いデータを削除
  for (const [peerId, data] of presences.entries()) {
    if (now - data.ts > STALE_MS) {
      presences.delete(peerId);
    }
  }

  // 部屋ごとにグループ化
  const byRoom = new Map();
  presences.forEach((p) => {
    const list = byRoom.get(p.room) || [];
    list.push(p);
    byRoom.set(p.room, list);
  });

  const items = [];
  let index = 1;
  for (const [roomId, people] of byRoom.entries()) {
    const tagged = people.find(p => p.tag);
    const rn = (people.find(p => p.rn) || {}).rn || '（名前のない部屋）';
    const tag = tagged ? tagged.tag : '';
    
    const idStr = roomId.substring(0, 4);
    const nameStr = stringPad(rn, 24);
    const tagStr = stringPad(tag ? `#${tag}` : '', 14);
    const usersStr = `[${people.length}]`.padEnd(7);
    
    items.push(`  [${index++}] ${idStr}     ${nameStr} ${tagStr} ${usersStr} ☁  ONLINE`);
  }

  if (items.length === 0) {
    items.push('  (現在アクティブな部屋はありません)');
  }

  roomList.setItems(items);
  screen.render();
}

async function startLobby() {
  statusBar.setContent(`  ⚡ [Nostr] Connecting...  |  [TURN] Fetching key...`);
  screen.render();

  let ice = null;
  try {
    const res = await fetch(TURN_WORKER_URL, { headers: { 'Origin': 'https://potalk.app' } });
    const d = await res.json();
    if (Array.isArray(d?.iceServers) && d.iceServers.length) {
      ice = d.iceServers;
      statusBar.setContent(`  ⚡ [Nostr] Connecting...  |  [TURN] Key acquired successfully`);
    }
  } catch (e) {
    statusBar.setContent(`  ⚡ [Nostr] Connecting...  |  [TURN] STUN mode (Direct)`);
  }
  screen.render();

  try {
    if (lobby) {
      lobby.leave();
    }
    const cfg = ice ? { ...TRYSTERO_BASE, rtcConfig: { iceServers: ice, iceTransportPolicy: 'relay' } } : TRYSTERO_BASE;
    lobby = joinRoom(cfg, LOBBY_ROOM);
    const presenceAction = lobby.makeAction('presence');

    presenceAction.onMessage = (d, { peerId }) => {
      if (!d || d.room == null) {
        presences.delete(peerId);
      } else {
        presences.set(peerId, {
          room: String(d.room).slice(0, 64),
          rn: String(d.rn ?? '').slice(0, 30),
          tag: String(d.tag ?? '').slice(0, 30),
          ts: Date.now()
        });
      }
      renderLobby();
    };

    lobby.onPeerLeave = peerId => {
      presences.delete(peerId);
      renderLobby();
    };

    // 定期更新
    setInterval(renderLobby, 5000);
    renderLobby();
    
    // ステータス更新
    const mode = ice ? 'Secure TURN Connection' : 'STUN mode (Direct)';
    statusBar.setContent(`  ⚡ [Nostr] Connected (7/7 relays)  |  [TURN] ${mode}`);
    screen.render();
  } catch (e) {
    statusBar.setContent(`  ⚠️ Lobby Connection Failed`);
    screen.render();
  }
}

// 終了ショートカット
screen.key(['q', 'C-c'], function(ch, key) {
  return process.exit(0);
});

// 手動リロード (r)
screen.key(['r'], function(ch, key) {
  presences.clear();
  roomList.setItems(['  (再読み込み中...)']);
  screen.render();
  startLobby();
});

screen.render();
startLobby();
