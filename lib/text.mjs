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

// 受け取った文字の整形。**本家の capText と同じ**（見えない制御文字・書字方向の上書き・
// 見えない文字を消し、コードポイント単位で切り詰める）。本家 PROTOCOL §7（v0.16.3〜）に一致。
// 部屋名は識別子なので、送る側と受ける側で必ず同じ処理を通すこと。
// 内訳：制御文字 / U+00AD / U+034F / U+061C / U+115F,U+1160,U+3164,U+FFA0（ハングルの埋め文字）/
// U+180E / U+200B,U+200C / U+200E,200F / U+2028,U+2029 / U+202A-202E / U+2060-2064 /
// U+2066-2069 / U+FEFF（実体を貼らずエスケープで書く）
// 残す文字：U+200D（ZWJ・絵文字の結合）と U+FE00-FE0F（異体字セレクタ）。消すと絵文字が壊れる。
export const UNSAFE_CHARS = /[\p{Cc}\u00AD\u034F\u061C\u115F\u1160\u180E\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/gu;
export const capText = (v, max, fallback = '') =>
  [...String(v ?? fallback).replace(UNSAFE_CHARS, '')].slice(0, max).join('');

// TUI（blessed）に出す前の整形。絵文字の後ろの U+FE0F（絵文字として表示させる指定）があると、
// blessed が幅を読み違えて後ろの文字を食う（「⌨️qramo」の qramo が消えた）ので外す。
// ⌨ 🖥 のように既定が文字表示の記号は、外すと文字の形（⌨ が ▬ のように）で出る。既定の絵文字を 💻 にしているのはこのため。
export const tuiText = s => String(s ?? '').replace(/️/g, '');
