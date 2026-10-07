// 端末上の表示幅（全角・絵文字＝2、半角＝1）。部屋名は日本語が多いので、文字数で揃えると列がずれる。
// 絵文字は「絵文字として表示される文字」（Emoji_Presentation）だけ 2。🖥 ⌨ のように既定が文字表示のものは 1
// （lib/tui.mjs で blessed にも同じ規則を教えている）。
const EMOJI_WIDE = /\p{Emoji_Presentation}/u;
const isWide = cp =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp > 0x7f && EMOJI_WIDE.test(String.fromCodePoint(cp)));

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
const UNSAFE_CHARS = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
export const capText = (v, max, fallback = '') =>
  [...String(v ?? fallback).replace(UNSAFE_CHARS, '')].slice(0, max).join('');

// TUI（blessed）に出す前の整形。絵文字の後ろの U+FE0F（絵文字として表示させる指定）があると、
// blessed が幅を読み違えて後ろの文字を食う（「⌨️qramo」の qramo が消えた）ので外す。
// ⌨ 🖥 のように既定が文字表示の記号は、外すと文字の形（⌨ が ▬ のように）で出る。既定の絵文字を 💻 にしているのはこのため。
export const tuiText = s => String(s ?? '').replace(/️/g, '');
