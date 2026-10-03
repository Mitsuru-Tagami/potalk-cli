import * as wrtc from 'node-datachannel/polyfill';
import WebSocket from 'ws';
import crypto from 'crypto';

// Polyfills for trystero/nostr in Node.js
Object.assign(globalThis, wrtc);
globalThis.WebSocket = WebSocket;
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.location) globalThis.location = { protocol: 'https:' };

import { joinRoom } from 'trystero/nostr';

const TRYSTERO_BASE = {
  appId: 'potalk.app',
  relayConfig: {
    urls: [
      'wss://yabu.me/v2',
      'wss://x.kojira.io', 
      'wss://relay.notoshi.win', 
      'wss://relay.mostr.pub'
    ],
    redundancy: 3
  }
};
const LOBBY_ROOM = '__lobby__';

// エラーで落ちないようにする (Nostrリレーの301など)
process.on('uncaughtException', (err) => {
  // 無視して継続
});

async function main() {
  console.log('--- ぽっと通話 ロビー情報取得テスト ---');
  console.log('📡 Trystero WebRTC メッシュに接続中...');
  
  try {
    const lobbyRoom = joinRoom(TRYSTERO_BASE, LOBBY_ROOM);
    const presenceAction = lobbyRoom.makeAction('presence');
    
    presenceAction.onMessage = (data, { peerId }) => {
      if (data && data.room) {
        console.log(`\n[入室通知] Peer: ${peerId.substring(0,6)}`);
        console.log(` 🏠 部屋名: ${data.rn || '（名前のない部屋）'}`);
        console.log(` 🆔 部屋ID: ${data.room.substring(0, 8)}...`);
        if (data.tag) console.log(` 🏷 タグ: ${data.tag}`);
        console.log(` 👤 ユーザー名: ${data.name || '名無し'}`);
      }
    };
    
    lobbyRoom.onPeerJoin = peerId => {
      console.log(`[+] ピア接続: ${peerId.substring(0,6)}`);
    };
    
    lobbyRoom.onPeerLeave = peerId => {
      console.log(`[-] ピア切断: ${peerId.substring(0,6)}`);
    };

    console.log('✅ ロビーに入室しました。WebRTCのデータチャネル経由でイベントを受信します。');
    console.log('（Ctrl+Cで終了します）');

  } catch (err) {
    console.error('❌ エラー:', err);
  }
}

main();
