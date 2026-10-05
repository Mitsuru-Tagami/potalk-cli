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
