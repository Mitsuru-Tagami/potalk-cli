// pot-turn-cli ── potalk-cli 専用の TURN 資格情報を発行する Cloudflare Worker
//
// ## 出典とライセンス
// このファイルは、ぽっと通話（本家）の worker/pot-turn.js を基に、potalk-cli 専用に
// 改変したものです。
//   Original: po-talk/po-talk.github.io の worker/pot-turn.js
//   MIT License — Copyright (c) 2026 qramo
//   （ライセンス全文は本家リポジトリの LICENSE を参照）
//
// ## 本家からの変更点
// - 認証はブラウザの Origin 許可リストではなく、**端末別 Bearer トークン**。
//   CLI（Node）からは Origin を任意に付けられるため、Origin は認証にならない。
// - CORS は付けない（ブラウザから使う入口ではない。CLI 専用）。
// - トークンは平文で保持せず、Secret の JSON `{名前: sha256ハッシュ(hex)}` と照合する。
//   提示されたトークンを SHA-256 化し、登録ハッシュと定数時間比較する。
// - 認証に失敗したリクエストは、**上流（Cloudflare の資格情報発行 API）を叩く前に**
//   403 で返す（本家の Origin 判定と同じ位置づけ）。
// - `CLI_TURN_TOKENS` が未設定・JSON 不正の場合は全リクエスト 403（fail-closed）。
// - 資格情報の ttl は本家と同じ 14400（4時間）。一本の接続の寿命はほぼ ttl で
//   決まる（本家 pot-turn.js の「判断の記録」参照）。
//
// ## この Worker の位置づけ（本家から引き継ぐ）
// 「合鍵を渡すだけ」＝資格情報の発行機であって、通信の経路ではない。音声・
// シグナリング・在室のいずれもここを通らず、保存もしない。
//
// ## デプロイ
//   Cloudflare Workers に配置。シークレットは環境変数で渡す（コードには書かない）。
//     TURN_KEY_ID         … Cloudflare Realtime の TURN キー ID
//     TURN_KEY_API_TOKEN  … 同 API トークン
//     CLI_TURN_TOKENS     … {"端末名": "sha256(端末用トークン) の hex（小文字）", ...}
//   端末の追加・失効は CLI_TURN_TOKENS の行を増減して再デプロイ（または Secret 更新）。

const UPSTREAM_BASE = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CREDENTIAL_TTL = 14400;   // 本家と同じ4時間

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 定数時間比較。長さが違う場合は即不一致（漏れるのは長さの情報だけ）。
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// CLI_TURN_TOKENS を登録ハッシュの配列にする。不正なら null（fail-closed の判定に使う）。
function parseRegisteredHashes(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const hashes = Object.values(parsed)
    .map(v => (typeof v === 'string' ? v.toLowerCase() : ''))
    .filter(v => /^[0-9a-f]{64}$/.test(v));
  return hashes.length ? hashes : null;
}

const deny = () => new Response('forbidden', {
  status: 403,
  headers: { 'Cache-Control': 'no-store' }
});
const unavailable = () => new Response(JSON.stringify({ error: 'turn unavailable' }), {
  status: 502,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// fetchImpl はテスト用に差し替え可能（通常はグローバルの fetch）。
export async function handleTurnRequest(request, env, fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', {
      status: 405,
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  // 認証は上流を叩く前に済ませる。登録側が壊れている場合も全て 403（fail-closed）。
  const hashes = parseRegisteredHashes(env?.CLI_TURN_TOKENS);
  if (!hashes) return deny();
  const presented = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!presented) return deny();
  const presentedHash = await sha256Hex(presented);
  if (!hashes.some(hash => constantTimeEqual(hash, presentedHash))) return deny();

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return unavailable();

  try {
    const r = await fetchImpl(
      `${UPSTREAM_BASE}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL })   // ＝一本の接続の寿命
      }
    );
    if (!r.ok) throw 0;
    const data = await r.json();
    if (!data.iceServers || !Array.isArray(data.iceServers) || data.iceServers.length === 0) throw 0;
    // 上流の応答は iceServers だけ取り出して返す（余計なフィールドを漏らさない）
    return new Response(JSON.stringify({ iceServers: data.iceServers }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch {
    // エラーは上流の文面を返さず丸める
    return unavailable();
  }
}

export default {
  fetch: (request, env) => handleTurnRequest(request, env)
};
