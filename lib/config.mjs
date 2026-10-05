// ぽっと通話（ブラウザ版）と**相互に乗り入れる**ための設定。
// ここの値は本家 po-talk.github.io の index.html と一致させること。
// 1つでもずれると、同じロビー・同じ部屋にいても互いに見えない（エラーも出ない）。

// Trystero は appId が違うと別世界になる。本家は 'kuramo-webrtc-call'。
export const TRYSTERO_BASE = {
  appId: 'kuramo-webrtc-call',
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
    redundancy: 5
  }
};

// TURN について：本家の資格情報発行 Worker はブラウザの Origin 許可リストで守られており、
// CLI 向けの正規の入口はまだ無い。なので CLI は当面 STUN のみで繋ぐ（TURN は取りに行かない）。
// 本家側は TURN 中継（relay 強制）で待っているので、こちらが STUN でも相手の中継候補には届く。
// CLI 用の入口が用意されたら、ここに資格情報の取得を足す。

export const LOBBY_ROOM = '__lobby__';
export const STALE_MS = 30000;   // 本家と同じ：この間 presence が来ない相手は消す
export const HEARTBEAT_MS = 5000; // 本家と同じ：部屋にいる間、ロビーへ在室を流す間隔

// 部屋まわり（本家 index.html の同名の値と揃える）
export const ROOM_MAX = 30;       // 部屋名・タグの長さ
export const CHAT_MAX = 60;       // ひとことの長さ
export const ROOM_CAP = 8;        // ふつうの部屋の定員
export const BC_CAP = 15;         // 配信部屋の定員
export const CAP_PROBE_MS = 15000; // 入ってからこの間だけ「定員の外なら自分から抜ける」
export const CAP_SETTLE_MS = 1500; // 相手のプロフィール（到着時刻）が揃うのを待ってから数える
