// 端末上の表示幅（全角＝2、半角＝1）。部屋名は日本語が多いので、文字数で揃えると列がずれる。
const isWide = cp =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff);

export const strWidth = s => [...s].reduce((w, ch) => w + (isWide(ch.codePointAt(0)) ? 2 : 1), 0);

// 表示幅 len に切り詰め／右パディングする
export function padWidth(str, len) {
  let out = '', w = 0;
  for (const ch of String(str ?? '')) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > len) break;
    out += ch; w += cw;
  }
  return out + ' '.repeat(len - w);
}

// 受け取った文字の整形。**本家の capText と同じ**（見えない制御文字・書字方向の上書きを消し、
// コードポイント単位で切り詰める）。部屋名は識別子なので、送る側と受ける側で必ず同じ処理を通すこと。
// 内訳：制御文字 / U+061C / U+200E,200F / U+202A-202E / U+2066-2069（実体を貼らずエスケープで書く）
const UNSAFE_CHARS = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;
export const capText = (v, max, fallback = '') =>
  [...String(v ?? fallback).replace(UNSAFE_CHARS, '')].slice(0, max).join('');
