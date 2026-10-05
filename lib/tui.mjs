// blessed（TUI の部品）の文字幅の数え方を、今のターミナルに合わせる。
// blessed は 👋 🦉 💻 ☕ のような絵文字を 1 マスと数えるが、ターミナル（ターミナル.app・iTerm2 など）は 2 マスで描く。
// 1 マスずれるたびに後ろの文字が食われたり、前の文字が残ったりした（「つながりましたた」「qramとつながりました」）。
// 漢字と同じ「2 マスの文字」の扱いに、絵文字として表示される文字（Emoji_Presentation）を足す。
import blessed from 'blessed';

const EMOJI_WIDE = /\p{Emoji_Presentation}/u;
let patched = false;

export function fixBlessedWidths() {
  if (patched) return;
  patched = true;
  const u = blessed.unicode;
  const charWidth = u.charWidth;
  u.charWidth = function (str, i) {
    const p = typeof str === 'number' ? str : u.codePointAt(str, i || 0);
    if (p > 0x7f && EMOJI_WIDE.test(String.fromCodePoint(p))) return 2;
    return charWidth.call(this, str, i);
  };
  // 2 マスの文字の後ろに詰め物（\x03）を入れて 1 マス余分に取らせる正規表現。元の範囲（CJK など）に絵文字を足す。
  // 元は u フラグ無しで書かれているので、範囲を u フラグの書き方で書き直している（中身は unicode.js の chars.wide / swide と同じ）。
  u.chars.all = new RegExp('(['
    + '\\u1100-\\u115f\\u2329\\u232a\\u2e80-\\u303e\\u3040-\\ua4cf\\uac00-\\ud7a3\\uf900-\\ufaff'
    + '\\ufe10-\\ufe19\\ufe30-\\ufe6f\\uff00-\\uff60\\uffe0-\\uffe6'
    + '\\u{20000}-\\u{2fffd}\\u{30000}-\\u{3fffd}'
    + ']|\\p{Emoji_Presentation})', 'gu');
}
