// Node.js で trystero を動かすためのブラウザ API の穴埋め。
// ★trystero より**先に** import すること（ESM は import 文の順に評価される）。
import wrtc from '@roamhq/wrtc';
import WebSocket from 'ws';
import crypto from 'crypto';

// WebRTC は @roamhq/wrtc（Chromium と同じ libwebrtc）。node-datachannel と違って音声トラックを扱えるので、
// 部屋では無音のトラックを送れる（本家は「全員から音が届く」前提で、届かない相手には送り直しを頼み続ける）。
const { nonstandard, getUserMedia, mediaDevices, ...webrtc } = wrtc;

// trystero は引数なしの setLocalDescription()（今のブラウザの書き方）を使うが、wrtc は
// 「Expected an object」で落ちる＝誰ともつながらない。状態を見て offer / answer を作って渡す。
//
// もう1つ：macOS の libwebrtc は select() でソケットを見ていて、ソケットが 1024 本を超えると
// ネットワーク処理が止まり、次の new RTCPeerConnection が永久に固まる。接続1本で 20 本前後のソケットを
// 使うので、**同時に開ける接続はおよそ 50 本が限界**。trystero は予備の接続を 20 本作り置き、
// ロビーの相手ごとにも作るので放っておくと踏む。そこで (1) 作り置きを減らし (2) 上限で断る。
const MAX_LIVE_PC = 40;
let livePc = 0;
class RTCPeerConnection extends webrtc.RTCPeerConnection {
  #closed = false;
  constructor(config) {
    // 上限を超えたら作らずに投げる＝trystero はその相手との接続をあきらめるだけで、固まるよりずっとよい
    if (livePc >= MAX_LIVE_PC) throw new DOMException('too many peer connections', 'OperationError');
    super(config);
    livePc++;
    this.addEventListener('connectionstatechange', () => { if (this.connectionState === 'closed') this.#release(); });
    // つながらなかった（failed）接続を trystero は見捨てるが close() はしないので、ソケットを掴んだまま
    // 溜まっていく（ロビーにいるだけで数分で上限に届いた）。trystero が後始末を済ませてから閉じる。
    const reap = () => {
      if (this.connectionState === 'failed' || this.iceConnectionState === 'failed') setTimeout(() => this.close(), 1000);
    };
    this.addEventListener('connectionstatechange', reap);
    this.addEventListener('iceconnectionstatechange', reap);
  }
  #release() { if (!this.#closed) { this.#closed = true; livePc--; } }
  close() { this.#release(); return super.close(); }
  async setLocalDescription(desc) {
    if (desc && desc.type) return super.setLocalDescription(desc);
    const answering = this.signalingState === 'have-remote-offer' || this.signalingState === 'have-local-pranswer';
    return super.setLocalDescription(answering ? await this.createAnswer() : await this.createOffer());
  }
}
Object.assign(globalThis, webrtc, { RTCPeerConnection });

// wrtc は接続が全部閉じると内部の土台（PeerConnectionFactory）を畳み、次の new RTCPeerConnection が
// 永久に固まる（ロビーでは接続の作成・破棄が絶えず起きるので数秒で踏む）。何もしない接続を1本、
// プロセスが終わるまで開けておいて、土台を畳ませない。
const keepFactory = new webrtc.RTCPeerConnection();

// trystero の作り置き（OfferPool・既定 20 本）を減らす。設定項目が無いので、trystero 内部と
// **同じ URL** で読み込んだモジュールの prototype を差し替える（ESM は URL ごとに 1 つしか評価されない）。
const POOL_KEEP = 4;
const { OfferPool } = await import(new URL('./offer-pool.mjs', import.meta.resolve('@trystero-p2p/core')));
const warmup = OfferPool.prototype.warmup;
OfferPool.prototype.warmup = function () {
  warmup.call(this);
  this.shift(Math.max(0, this.pool.length - POOL_KEEP)).forEach(peer => peer.destroy());
};
// 使い終わった接続は作り置きに戻される（recycle → push）ので、戻す側でも上限を守る
const push = OfferPool.prototype.push;
OfferPool.prototype.push = function (peer) {
  if (this.pool.length >= POOL_KEEP && !this.pooled.has(peer)) { peer.destroy(); return; }
  push.call(this, peer);
};
export const livePeerConnections = () => livePc;
export const { RTCAudioSource, RTCAudioSink } = nonstandard;

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
