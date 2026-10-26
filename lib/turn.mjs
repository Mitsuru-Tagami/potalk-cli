// TURN ── 自前の Cloudflare Worker（worker/pot-turn-cli.js）から ICE 資格情報を取り、
// trystero の rtcConfig として渡すための層。
//
// 決めたこと（Issue #2 の comment-6406976378、設計の決定4点）：
// 1. 認証は端末別 Bearer トークン（この端末の分を環境変数で持つ）。
// 2. 資格情報が取れたら iceTransportPolicy: 'relay' で接続する（相手に IP を見せない）。
//    取れなかったら従来どおり STUN 直結にフォールバックし、その旨を console に明示する。
// 3. 資格情報の ttl は Worker 側で 4時間。こちらは取得を10分キャッシュし、
//    5分間隔で取り直して「これから作る接続」に新鮮な資格情報が渡るようにする（本家方式）。
// 4. 環境変数 POTALK_TURN_WORKER_URL / POTALK_TURN_TOKEN が未設定なら TURN は無効で、
//    従来と完全に同じ挙動になる。リポジトリに Worker URL の既定値は置かない。
//
// trystero（@trystero-p2p/core 0.25.4）の実物で確認した受け渡し方：
// - joinRoom の config は参照のまま保持され、ピアを作るたびに読み直される。
//   ピア生成時は new RTCPeerConnection({ iceServers: 既定STUN, ...rtcConfig }) と
//   rtcConfig が最後に広がるので、rtcConfig.iceServers が既定を丸ごと置き換え、
//   iceTransportPolicy もそのまま届く。
// - したがって、このモジュールが返す共有 config オブジェクトの rtcConfig を
//   差し替えれば、その後に作られるピア（応答側は都度生成、発信側はオファープールの
//   新規生成分）は新しい資格情報で接続する。
// - 制約：既に作られたピア（プールの作り置き・接続済み）の RTCPeerConnection は
//   作られた時点の iceServers で固定され、差し替わらない。本家と同じく、既存の接続は
//   「誕生時の資格情報」で生き、期限が来ると落ちうる。プールの作り置きは接続に
//   使われれば消費され、切断やリース切れでも回転するので、長時間運転でも新しい
//   接続は概ね新しい資格情報になる（厳密な保証ではない）。
import { TRYSTERO_BASE } from './config.mjs';

export const TURN_CACHE_MS = 10 * 60 * 1000;    // 本家 index.html の ICE_TTL_MS と同じ
const TURN_REFRESH_MS = 5 * 60 * 1000;          // 本家 index.html の ICE_REFRESH_MS と同じ
const TURN_FETCH_TIMEOUT_MS = 5000;
// Worker が発行する資格情報の寿命（worker/pot-turn-cli.js の ttl 14400 秒）。
// 最後の成功からこれを過ぎても更新できないなら、期限切れの資格情報を掴み続けるより
// STUN 直結に落とす（relay 専用のまま死んだ資格情報だと接続自体ができなくなる）。
const TURN_CREDENTIAL_TTL_MS = 14400 * 1000;

const FALLBACK_WARN = '⚠ TURN の資格情報を取得できませんでした。STUN 直結（相手に IP が見える状態）で接続します';

// fetch・時刻・警告先を差し替えられるローダー（テスト用）。
export function createTurnLoader({
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...a) => console.warn(...a),
  cacheMs = TURN_CACHE_MS,
  timeoutMs = TURN_FETCH_TIMEOUT_MS
} = {}) {
  const url = String(env.POTALK_TURN_WORKER_URL || '').trim();
  const token = String(env.POTALK_TURN_TOKEN || '').trim();
  const configured = Boolean(url && token);
  let cache = null;      // { value, fetchedAt }（失敗も含めて cacheMs の間は使い回す。本家方式）
  let inflight = null;   // 進行中の取得（同時呼び出しは1回にまとめる）

  async function fetchFresh() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal
      });
      if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
      const data = await res.json();
      const servers = data?.iceServers;
      if (!Array.isArray(servers) || servers.length === 0 ||
          !servers.every(s => s && (typeof s.urls === 'string' || Array.isArray(s.urls)))) {
        throw new Error('unexpected response');
      }
      return { iceServers: servers, iceTransportPolicy: 'relay' };
    } finally {
      clearTimeout(timer);
    }
  }

  // 成功したら rtcConfig、未設定・失敗なら null を返す（失敗時は警告を出す）。
  function loadTurnRtcConfig() {
    if (!configured) return Promise.resolve(null);
    if (cache && now() - cache.fetchedAt < cacheMs) return Promise.resolve(cache.value);
    if (inflight) return inflight;
    inflight = (async () => {
      let value = null;
      try {
        value = await fetchFresh();
      } catch {
        warn(FALLBACK_WARN);
      }
      cache = { value, fetchedAt: now() };
      inflight = null;
      return value;
    })();
    return inflight;
  }

  return {
    configured,
    loadTurnRtcConfig,
    // 最後の取得結果 { value, fetchedAt }（未取得なら null）。同期で覗く用。
    cachedTurnRtcConfig: () => cache
  };
}

// joinRoom に渡す共有 config。rtcConfig を定期的に差し替えることで、
// 長時間プロセスでも「これから作る接続」に新しい資格情報を渡す。
export function createLiveTrysteroConfig(loader, {
  now = () => Date.now(),
  warn = (...a) => console.warn(...a),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = timer => clearInterval(timer),
  refreshMs = TURN_REFRESH_MS,
  credentialTtlMs = TURN_CREDENTIAL_TTL_MS
} = {}) {
  const config = { ...TRYSTERO_BASE };
  let started = false;
  let timer = null;
  let lastSuccessAt = 0;

  async function refresh() {
    const value = await loader.loadTurnRtcConfig();
    if (value) {
      config.rtcConfig = value;
      const entry = loader.cachedTurnRtcConfig?.();
      lastSuccessAt = entry?.value ? entry.fetchedAt : now();
    } else if (config.rtcConfig && lastSuccessAt && now() - lastSuccessAt > credentialTtlMs) {
      // 更新できないまま資格情報の寿命を超えた。死んだ資格情報を掴み続けない。
      delete config.rtcConfig;
      lastSuccessAt = 0;
      warn('⚠ TURN の資格情報を更新できない状態が続いたため、STUN 直結（相手に IP が見える状態）に切り替えました');
    }
    // 更新に失敗しても寿命のうちは前回の資格情報を使い続ける（STUN 直結より隠蔽が保てる）。
  }

  function start() {
    if (started) return;
    started = true;
    if (!loader.configured) return;   // 未設定なら何もしない（従来挙動）
    void refresh();
    timer = setIntervalImpl(() => { void refresh(); }, refreshMs);
    timer?.unref?.();
  }

  function stop() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
    started = false;
  }

  return { config, start, stop, refresh };
}

const defaultLoader = createTurnLoader();
const defaultLive = createLiveTrysteroConfig(defaultLoader);

// 既定ローダーの取得関数（コマンド側が事前取得に使う）。
export const loadTurnRtcConfig = defaultLoader.loadTurnRtcConfig;

// joinRoom に渡す config を返す。初回に定期リフレッシュを始める。
// TURN 未設定なら rtcConfig の無い、従来と同じ config が返る。
export function trysteroConfig() {
  defaultLive.start();
  return defaultLive.config;
}

// ロビー・部屋を開く前に資格情報を先に取っておく（最初の接続から TURN を使うため）。
// 未設定なら即座に null が返る。
export function primeTurnRtcConfig() {
  defaultLive.start();
  return defaultLoader.loadTurnRtcConfig();
}

// TUI のステータス表示用（同期）。現在の ICE の状態を短く言う。
export function iceStatusLabel() {
  if (!defaultLoader.configured) return 'STUN only';
  return defaultLive.config.rtcConfig ? 'TURN (relay)' : 'STUN only（TURN 取得失敗）';
}
