// Node.js で trystero を動かすためのブラウザ API の穴埋め。
// ★trystero より**先に** import すること（ESM は import 文の順に評価される）。
import * as wrtc from 'node-datachannel/polyfill';
import WebSocket from 'ws';
import crypto from 'crypto';

Object.assign(globalThis, wrtc);

// Nostr リレーの 301 や切断で ws が error を投げるとプロセスごと落ちるので、ここで受け止める。
// （trystero 側が再接続するので、握りつぶして問題ない）
class SafeWebSocket extends WebSocket {
  constructor(...args) {
    super(...args);
    this.on('error', () => {});
  }
}
globalThis.WebSocket = SafeWebSocket;

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
// ★window / location は**偽装しないこと**。trystero 0.25 は `typeof window` でブラウザか判定し、
// ブラウザだと思うと addEventListener('beforeunload') を呼んで joinRoom ごと例外で落ちる。
