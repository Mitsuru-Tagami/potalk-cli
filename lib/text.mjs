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
