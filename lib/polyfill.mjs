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
// 生存中の接続の台帳と「最後に状態が動いた時刻」。滞留の掃除（sweepStalePcs）が使う。
const liveRegistry = new Set();
// 接続確立も切断への遷移もなく、この時間ずっと止まっている接続は実質死んでいる
// （trystero 自身は disconnected を 5 秒で見限る。確立に要する時間を見ても 10 分は十分すぎる猶予）。
const STALE_PC_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
class RTCPeerConnection extends webrtc.RTCPeerConnection {
  #closed = false;
  #lastActivity = Date.now();
  // localDescription の写し（{type, sdp} | null）。ネイティブ getter の読み取り自体が
  // segfault の引き金になるため（下記の get localDescription のコメント参照）、
  // 安全なタイミングで写しを取り、普段の読み取りはここから返す。
  #localSnapshot = null;
  #localSnapshotTaken = false;
  constructor(config) {
    // 上限を超えたら作らずに投げる＝trystero はその相手との接続をあきらめるだけで、固まるよりずっとよい
    if (livePc >= MAX_LIVE_PC) throw new DOMException('too many peer connections', 'OperationError');
    super(config);
    livePc++;
    liveRegistry.add(this);
    ensureSweeper();
    const noteActivity = () => { this.#lastActivity = Date.now(); };
    this.addEventListener('connectionstatechange', noteActivity);
    this.addEventListener('iceconnectionstatechange', noteActivity);
    this.addEventListener('connectionstatechange', () => { if (this.connectionState === 'closed') this.#release(); });
    // つながらなかった（failed）接続を trystero は見捨てるが close() はしないので、ソケットを掴んだまま
    // 溜まっていく（ロビーにいるだけで数分で上限に届いた）。trystero が後始末を済ませてから閉じる。
    const reap = () => {
      if (this.connectionState === 'failed' || this.iceConnectionState === 'failed') setTimeout(() => this.close(), 1000);
    };
    this.addEventListener('connectionstatechange', reap);
    this.addEventListener('iceconnectionstatechange', reap);
    // ICE 収集が完了したら、その時点の（候補が揃った）localDescription を写しに取る
    this.addEventListener('icegatheringstatechange', () => {
      if (this.iceGatheringState === 'complete') this.#refreshLocalSnapshot();
    });
  }
  // localDescription の写しを取り直す。ネイティブを読むのはこの1回だけにする。
  #refreshLocalSnapshot() {
    if (this.#closed) { this.#localSnapshot = null; this.#localSnapshotTaken = true; return; }
    try {
      const d = super.localDescription;
      this.#localSnapshot = d ? { type: d.type, sdp: d.sdp } : null;
      this.#localSnapshotTaken = true;
    } catch { /* 読めなかったときは前の写しのままにする */ }
  }
  #release() { if (!this.#closed) { this.#closed = true; livePc--; liveRegistry.delete(this); } }
  close() { this.#release(); return super.close(); }
  // 掃除屋から見た状態：つながっているか／最後に状態が動いてからの経過（now は掃除屋が渡す）
  pcStaleInfo(now) {
    return {
      connected: this.connectionState === 'connected' || this.iceConnectionState === 'connected' || this.iceConnectionState === 'completed',
      idleMs: now - this.#lastActivity,
    };
  }
  // description を読むと、wrtc の SDP 文字列化（webrtc::SdpSerialize）が
  // segfault することがある。当初は「閉じた接続の読み取り」が原因と考えて
  // 閉じた接続だけ null を返すガードを入れた（PR #78・#80）が、2026-11-13 に
  // 採取できたコア4件（あまあま 11/9・関西 11/12・紅茶 11/12 と 11/13）を
  // 全部 gdb で見ると、落ちた場所は4件とも GetLocalDescription で、
  // ガード適用後の紅茶（11/13）も含まれる。つまり**開いている接続の
  // localDescription の読み取り自体**が引き金で、読み取り回数に比例して
  // 踏む類の競合とみるのが正しい。
  //
  // 対策：localDescription は「写し」から返す。写しは
  // setLocalDescription の完了直後（operations chain の内側）と
  // ICE 収集の完了時に取り直すだけで、普段の読み取りではネイティブに
  // 触らない。trystero の読み手は .type と .sdp しか使わないので、
  // {type, sdp} の写しで足りる。trickle ICE では候補は個別に流れるため、
  // setLocalDescription 直後の写しでシグナリングの意味も変わらない。
  // 写しがまだ無い（setLocalDescription 前）ときだけネイティブを読む
  // （description が無い状態の読み取りは素の null が返る）。
  //
  // remoteDescription 以下の getter は、コアでの実績がないため従来どおり
  // 「閉じた接続では null を返す」ガードだけに留める（仕様上も closed な
  // 接続の description は null）。
  #descriptionClosed() {
    return this.#closed || this.connectionState === 'closed' || this.signalingState === 'closed';
  }
  get localDescription() {
    if (this.#descriptionClosed()) return null;
    if (this.#localSnapshotTaken) return this.#localSnapshot ? { ...this.#localSnapshot } : null;
    return super.localDescription;
  }
  get remoteDescription() { return this.#descriptionClosed() ? null : super.remoteDescription; }
  get currentLocalDescription() { return this.#descriptionClosed() ? null : super.currentLocalDescription; }
  get pendingLocalDescription() { return this.#descriptionClosed() ? null : super.pendingLocalDescription; }
  get currentRemoteDescription() { return this.#descriptionClosed() ? null : super.currentRemoteDescription; }
  get pendingRemoteDescription() { return this.#descriptionClosed() ? null : super.pendingRemoteDescription; }
  // ブラウザは offer/answer まわりの操作を**1つずつ順番に**処理する（仕様の operations chain）が、wrtc はしない。
  // 相手が音声トラックを足して交渉し直してきたときに操作が追い越し合い、「Called in wrong state: stable」で
  // 接続ごと落ちた（2026-10-05・🫖ぽっと通話で再現）。同じ順番待ちをここで作る。
  #chain = Promise.resolve();
  #enqueue(fn) {
    const p = this.#chain.then(fn);
    this.#chain = p.catch(() => {});
    return p;
  }
  createOffer(...a) { return this.#enqueue(() => super.createOffer(...a)); }
  createAnswer(...a) { return this.#enqueue(() => super.createAnswer(...a)); }
  setRemoteDescription(desc) { return this.#enqueue(() => super.setRemoteDescription(desc)); }
  addIceCandidate(c) { return this.#enqueue(() => super.addIceCandidate(c)); }
  setLocalDescription(desc) {
    return this.#enqueue(async () => {
      let result;
      if (desc && desc.type) result = await super.setLocalDescription(desc);
      else {
        // 引数なし＝今の状態に合うものを作る（順番待ちの中なので super を直接呼ぶ。this.createXxx だと自分を待って詰まる）
        const answering = this.signalingState === 'have-remote-offer' || this.signalingState === 'have-local-pranswer';
        result = await super.setLocalDescription(answering ? await super.createAnswer() : await super.createOffer());
      }
      // 完了直後がいちばん状態の落ち着いた瞬間。ここで写しを取って、以後の
      // localDescription の読み取りはネイティブに触らせない。
      this.#refreshLocalSnapshot();
      return result;
    });
  }
}
Object.assign(globalThis, webrtc, { RTCPeerConnection });

// trystero の作り置き（OfferPool・既定 20 本）を減らす。設定項目が無いので、trystero 内部と
// **同じ URL** で読み込んだモジュールの prototype を差し替える（ESM は URL ごとに 1 つしか評価されない）。
const POOL_KEEP = 4;
// ★trystero の内部の作りに頼っているので、package.json で trystero の版を固定している。
//   版を上げて作りが変わったら、黙って効かなくなる（＝また接続が溜まって固まる）前に、ここで気づけるようにする。
const { OfferPool } = await import(new URL('./offer-pool.mjs', import.meta.resolve('@trystero-p2p/core')));
export const offerPoolPatched = typeof OfferPool?.prototype?.warmup === 'function'
  && typeof OfferPool.prototype.push === 'function' && typeof OfferPool.prototype.shift === 'function';
if (offerPoolPatched) {
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
} else {
  console.warn('[ptk] trystero の作りが想定と違うため、作り置きの接続を減らせません（lib/polyfill.mjs）。接続が増えて固まることがあります');
}
export const livePeerConnections = () => livePc;
// 滞留接続の掃除：trystero の後始末（exitPeer→destroy、failed の回収）をすり抜けて、
// 状態が止まったまま台帳に残る接続が少しずつ溜まり、上限に張り付く（2026-11-08〜11 の
// 関西の [pc] ログで実測：約40時間で 11→40、以後は上限のまま）。つながっている接続には
// 触らず、「確立も遷移もなく STALE_PC_MS 止まっている」ものだけを閉じる。
// 戻り値は閉じた本数。now／staleMs はテスト用に差し替えられる。
export function sweepStalePcs({ now = Date.now(), staleMs = STALE_PC_MS, log = console.error } = {}) {
  let closed = 0;
  for (const pc of [...liveRegistry]) {
    const { connected, idleMs } = pc.pcStaleInfo(now);
    if (connected || idleMs < staleMs) continue;
    try { pc.close(); } catch { /* 閉じかけの競合は無視する */ }
    closed++;
  }
  if (closed > 0) log(`[pc] sweep: 状態の止まった接続を ${closed} 本閉じた（live=${livePc}）`);
  return closed;
}
let sweeperTimer = null;
function ensureSweeper() {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => sweepStalePcs(), SWEEP_INTERVAL_MS);
  sweeperTimer.unref();
}
// PTK_DEBUG のときだけ、生存中の接続数を定期的に log へ出す（上限への接近と滞留の内訳を観測するため）。
// 戻り値は止める関数。タイマーは unref するので、プロセスの終了を妨げない。
export function startLivePcLog({ intervalMs = 60000, log = console.error } = {}) {
  if (!process.env.PTK_DEBUG) return () => {};
  const timer = setInterval(() => log(`[pc] live=${livePc}`), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
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
