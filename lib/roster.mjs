// 配信部屋の「話してよい人の名簿」の検証。本家 index.html の acceptRoster をそのまま移したもの。
// ★ここを緩めると配信部屋の意味が無くなる（改造クライアントの声まで鳴る）ので、条件は全部残すこと。
//  ・名簿は配信者（オーナー）の秘密鍵で署名されている。署名の対象は `部屋ID・時刻・配信者のpeerId・peerId一覧`
//    （別の部屋の名簿は持ち込めない／配信者を偽れない）
//  ・添えられた公開鍵は、部屋ID の末尾の指紋（~pk~…＝公開鍵の SHA-256 先頭 16 バイト）と一致するものしか信じない
//    （＝自己申告のオーナーは通らない）
//  ・時刻は必ず増える。採用済みより古い名簿は捨てる（使い回しが効かない）
//  ・時間では失効させない（配信者のタブが裏に回ると配り直しが遅れ、鮮度で切ると無音になる）
const SPEAKER_MAX = 8;
const B64U_RE = /^[A-Za-z0-9_-]{80,100}$/;   // 公開鍵 87 文字・署名 86 文字。長さの桁だけ見る
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const PK_SEP = '~pk~';
const FP_RE = /^[A-Za-z0-9_-]{22}$/;

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => new Uint8Array(Buffer.from(String(s), 'base64url'));
const enc = s => new TextEncoder().encode(s);
export const rosterMsg = (id, t, own, ids) => id + '\n' + t + '\n' + own + '\n' + ids.join(',');
export const fpOf = async pub => b64u((await crypto.subtle.digest('SHA-256', unb64u(pub))).slice(0, 16));
const roomPk = id => { const s = String(id ?? ''), i = s.lastIndexOf(PK_SEP); const p = i < 0 ? '' : s.slice(i + PK_SEP.length); return FP_RE.test(p) ? p : ''; };

/**
 * 受け取った名簿を確かめる。正しければ { t, own, ids, roster }、だめなら null。
 * @param {string} roomId   いまいる部屋の ID（`ハッシュ~pk~指紋`）
 * @param {object} d        届いた名簿 { pk, t, o, ids, sig }
 * @param {number} seenT    採用済みの名簿の時刻（これ以下は捨てる）
 */
export async function verifyRoster(roomId, d, seenT = 0) {
  if (!d || typeof d !== 'object') return null;
  const pub = typeof d.pk === 'string' && B64U_RE.test(d.pk) ? d.pk : '';
  const sig = typeof d.sig === 'string' && B64U_RE.test(d.sig) ? d.sig : '';
  const t = d.t;
  if (!pub || !sig || !Number.isSafeInteger(t) || t <= seenT) return null;
  const ids = Array.isArray(d.ids) ? d.ids.filter(x => typeof x === 'string' && x.length <= 40).slice(0, SPEAKER_MAX) : [];
  const own = typeof d.o === 'string' && d.o.length <= 40 ? d.o : '';
  const fp = roomPk(roomId);
  // ★この1行が要。部屋 ID の指紋と一致する公開鍵しか信じない
  if (!fp || await fpOf(pub).catch(() => '') !== fp) return null;
  const key = await crypto.subtle.importKey('raw', unb64u(pub), ECDSA, false, ['verify']).catch(() => null);
  if (!key) return null;
  const ok = await crypto.subtle.verify(SIGN_ALG, key, unb64u(sig), enc(rosterMsg(roomId, t, own, ids))).catch(() => false);
  if (!ok) return null;
  return { t, own, ids, roster: { pk: pub, t, o: own, ids, sig } };
}
