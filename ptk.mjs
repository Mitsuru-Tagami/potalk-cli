import { Relay } from 'nostr-tools';
import WebSocket from 'ws';

// Node.js環境でWebSocketを利用できるようにする
globalThis.WebSocket = WebSocket;

const RELAYS = [
  'wss://relay.primal.net',
  'wss://purplerelay.com',
  'wss://bucket.coracle.social',
  'wss://yabu.me/v2',
  'wss://x.kojira.io',
  'wss://relay.notoshi.win',
  'wss://relay.mostr.pub'
];

async function main() {
  console.log('ぽっと通話 CLI (ptk) - シグナリング実験用');
  
  const relayUrl = RELAYS[3]; // テストとして yabu.me/v2 を使用
  console.log(`Connecting to ${relayUrl}...`);
  
  try {
    const relay = await Relay.connect(relayUrl);
    console.log(`Connected to ${relay.url}`);
    
    // イベント購読の簡単なテスト
    const sub = relay.subscribe([
      {
        kinds: [1], // Text Note
        limit: 1
      }
    ], {
      onevent(event) {
        console.log('--- Received Event ---');
        console.log(`Kind: ${event.kind}`);
        console.log(`Pubkey: ${event.pubkey.substring(0, 8)}...`);
        console.log(`Content: ${event.content.substring(0, 50).replace(/\n/g, ' ')}...`);
      },
      oneose() {
        console.log('--- EOSE (End of Stored Events) ---');
        relay.close();
        console.log('Disconnected.');
      }
    });

  } catch (err) {
    console.error(`Connection failed: ${err.message}`);
  }
}

main();
