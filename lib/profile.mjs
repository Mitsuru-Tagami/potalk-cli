// 名乗り（名前・絵文字）を覚えておく。ブラウザ版がブラウザに覚えておくのと同じで、
// 一度 --name / --emoji を付けて起動すれば、次からはそれを使う。
// 置き場所：$XDG_CONFIG_HOME/ptk/profile.json（無ければ ~/.config/ptk/profile.json）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { capText } from './text.mjs';

export const DEFAULT_PROFILE = { name: 'ゲスト', emoji: '💻' };
export const profilePath = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ptk', 'profile.json');

// 本家と同じ上限で切り詰める（名前 20 文字・絵文字 8 文字）
const clean = p => ({
  name: capText(p?.name, 20) || DEFAULT_PROFILE.name,
  emoji: capText(p?.emoji, 8) || DEFAULT_PROFILE.emoji
});

export function loadProfile() {
  try { return clean(JSON.parse(fs.readFileSync(profilePath(), 'utf8'))); }
  catch { return { ...DEFAULT_PROFILE }; }   // まだ無い・壊れている → 既定
}

/**
 * 覚えている名乗りに、今回のオプションを重ねる。オプションがあれば保存し直す。
 * @returns {{ profile: {name, emoji}, saved: boolean, error?: string }}
 */
export function resolveProfile({ name, emoji } = {}) {
  const base = loadProfile();
  if (name === undefined && emoji === undefined) return { profile: base, saved: false };
  const profile = clean({ name: name ?? base.name, emoji: emoji ?? base.emoji });
  try {
    fs.mkdirSync(path.dirname(profilePath()), { recursive: true });
    fs.writeFileSync(profilePath(), JSON.stringify(profile, null, 2) + '\n');
    return { profile, saved: true };
  } catch (e) {
    return { profile, saved: false, error: e.message };   // 書けなくても今回はその名前で入る
  }
}
