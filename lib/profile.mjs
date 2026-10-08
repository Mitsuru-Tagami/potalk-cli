// 名乗り（名前・絵文字）を覚えておく。ブラウザ版がブラウザに覚えておくのと同じで、
// 一度 --name / --emoji を付けて起動すれば、次からはそれを使う。
// 置き場所：$XDG_CONFIG_HOME/ptk/profile.json（無ければ ~/.config/ptk/profile.json）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { capText } from './text.mjs';

export const DEFAULT_PROFILE = { name: 'ゲスト', emoji: '💻' };

// 名乗っていない人の初期名：コーヒー × ハードボイルド／フィルム・ノワール（Issue #16）。本家の「お茶 × サメ映画テイスト」
// （randomTeaName）と同じ作りで、お茶をコーヒーの銘柄に、B 級サメ映画の邦題っぽさを探偵小説・ノワールの邦題っぽさに替えた。
// 基本は夜の街の一杯、たまに（CHAOS_RATE）物騒なタイトル。
// 初回だけ決めてすぐ保存する＝起動のたびに名前が変わらない（レアは「初回の引き」）。
const COFFEE_MOD_COZY = ['孤独な', '真夜中の', '眠らない', '雨に濡れた', '裏通りの', '路地裏の', '名もなき', 'さすらいの',
  '最後の一杯の', '夜明け前の', '午前2時の', '港町の', '霧の', '黄昏の', '灰色の', '冷めた', '苦い', '渇いた', '紫煙の'];
const COFFEE_MOD_CHAOS = ['沈黙の', '地獄の', '帰ってきた', '二度死ぬ', '復讐の', '血塗られた', '禁じられた', '死を呼ぶ', '悪魔の'];
const COFFEES = ['ブラジル', 'コロンビア', 'エチオピア', 'モカ', 'キリマンジャロ', 'マンデリン', 'グアテマラ', 'コスタリカ',
  'ケニア', 'ブルーマウンテン', 'コナ', 'トラジャ', 'イルガチェフェ', 'ゲイシャ', 'パナマ', 'ホンジュラス', 'ルワンダ',
  'エルサルバドル', 'ペルー', 'イエメン', 'タンザニア'];
const CHAOS_RATE = 0.13;   // 本家と同じ。レアの頻度はこの数字だけで決まる
const pickRand = arr => arr[Math.floor(Math.random() * arr.length)];
export const randomCoffeeName = () => pickRand(Math.random() < CHAOS_RATE ? COFFEE_MOD_CHAOS : COFFEE_MOD_COZY) + pickRand(COFFEES);
export const profilePath = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ptk', 'profile.json');

// 本家と同じ上限で切り詰める（名前 20 文字・絵文字 8 文字）
const clean = p => ({
  name: capText(p?.name, 20) || DEFAULT_PROFILE.name,
  emoji: capText(p?.emoji, 8) || DEFAULT_PROFILE.emoji
});

// 覚えている名乗り。まだ無い（初めて）・壊れている → コーヒーの名前を引いて保存する
export function loadProfile() {
  try { return clean(JSON.parse(fs.readFileSync(profilePath(), 'utf8'))); }
  catch {
    const first = { name: randomCoffeeName(), emoji: DEFAULT_PROFILE.emoji };
    save(first);   // 書けなくても今回はこの名前で入る
    return first;
  }
}

function save(profile) {
  try {
    fs.mkdirSync(path.dirname(profilePath()), { recursive: true });
    fs.writeFileSync(profilePath(), JSON.stringify(profile, null, 2) + '\n');
    return null;
  } catch (e) { return e.message; }
}

/**
 * 覚えている名乗りに、今回のオプションを重ねる。オプションがあれば保存し直す。
 * @returns {{ profile: {name, emoji}, saved: boolean, error?: string }}
 */
export function resolveProfile({ name, emoji } = {}) {
  const base = loadProfile();
  if (name === undefined && emoji === undefined) return { profile: base, saved: false };
  const profile = clean({ name: name ?? base.name, emoji: emoji ?? base.emoji });
  const error = save(profile);
  return error ? { profile, saved: false, error } : { profile, saved: true };   // 書けなくても今回はその名前で入る
}
