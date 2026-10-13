import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';
import { CHAT_MAX } from './config.mjs';

const require = createRequire(import.meta.url);
const CONSTELLATION_DATA = require('../data/constellations.json');

export const CONSTELLATIONS = Object.freeze(CONSTELLATION_DATA.map(item => Object.freeze({
  ...item,
  aliases: Object.freeze(item.aliases ?? [])
})));

export const ZODIAC_SIGNS = Object.freeze([
  '牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座',
  '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座'
]);

// いずれもこのプロジェクトのために書き起こした、気軽な一言です。
const HOROSCOPE_ASIDES = Object.freeze({
  牡羊座: Object.freeze(['ひらめきは小さく試すと気楽。', 'まず一つ片づけると気分が軽く。', '休憩も立派な作戦。']),
  牡牛座: Object.freeze(['お気に入りを使うと気分転換に。', 'いつものペースを大切に。', '手元を整えると落ち着きそう。']),
  双子座: Object.freeze(['気になった言葉をメモしてみて。', '短い雑談がよい息抜きに。', '新しい道を一つ試してみよう。']),
  蟹座: Object.freeze(['身近な人にひとこと声をかけて。', '慣れた場所でひと息つこう。', '自分のペースを守るのも大切。']),
  獅子座: Object.freeze(['小さな工夫を誰かと共有して。', '好きな色を身につけてみよう。', 'まずは楽しめる方から始めて。']),
  乙女座: Object.freeze(['気づいたことを一つだけ整えて。', '予定に短い余白をつくろう。', '仕上げに一度見直すと安心。']),
  天秤座: Object.freeze(['迷ったら、いったん両方書き出して。', '会話では聞き役も楽しんで。', '机の上に好きなものを一つ。']),
  蠍座: Object.freeze(['集中したいことを一つ選ぼう。', '気になることは短く調べてみて。', '深呼吸してから次の一歩へ。']),
  射手座: Object.freeze(['いつもと違う景色を眺めてみて。', '思いつきはメモに残しておこう。', 'まず五分だけ動いてみよう。']),
  山羊座: Object.freeze(['小さな区切りをつけるとすっきり。', '今日できたことも数えてみて。', '道具の手入れが気分転換に。']),
  水瓶座: Object.freeze(['別のやり方を一つ試してみよう。', 'ひとり時間も予定に入れて。', 'ふとした発想をメモしてみて。']),
  魚座: Object.freeze(['好きな音楽でひと息つこう。', '水分補給を忘れずに。', 'やさしい言葉を自分にも。'])
});

const OMIKUJI_RESULTS = Object.freeze([
  Object.freeze({ fortune: '大吉', comment: '追い風気分。', suggestion: '気になる用事を5分だけ。' }),
  Object.freeze({ fortune: '吉', comment: '会話に小さなヒント。', suggestion: '誰かにひとつ質問。' }),
  Object.freeze({ fortune: '中吉', comment: 'いつもの手順を丁寧に。', suggestion: '机の上を一つ整える。' }),
  Object.freeze({ fortune: '小吉', comment: 'ひと息でリズムを戻そう。', suggestion: '水を一杯飲んで深呼吸。' }),
  Object.freeze({ fortune: '末吉', comment: '焦らず準備を整える日。', suggestion: '次の予定をひとつ確認。' }),
  Object.freeze({ fortune: '凶', comment: '慎重さを味方に。', suggestion: '大事な送信は一度見直す。' })
]);

function pickRandom(items, randomIntImpl) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = randomIntImpl(0, items.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) return null;
  return items[index];
}

function fitsChat(message) {
  return [...message].length <= CHAT_MAX && !/[\r\n\u2028\u2029]/u.test(message);
}

function normalizedInput(argument) {
  return String(argument ?? '').trim().normalize('NFKC');
}

function resolveConstellation(argument) {
  const input = normalizedInput(argument);
  if (!input) return null;
  const normalized = input.replace(/座$/u, '');
  return CONSTELLATIONS.find(item => {
    const candidates = [item.name.replace(/座$/u, ''), ...item.aliases.map(alias => alias.replace(/座$/u, ''))];
    return candidates.some(candidate => candidate.normalize('NFKC') === normalized)
      || item.latin.toLocaleLowerCase('en') === input.toLocaleLowerCase('en')
      || item.abbr.toLocaleLowerCase('en') === input.toLocaleLowerCase('en');
  });
}

function resolveZodiacSign(argument) {
  const input = normalizedInput(argument);
  if (!input) return null;
  return ZODIAC_SIGNS.find(sign => sign === input || sign.slice(0, -1) === input) ?? undefined;
}

/** 88星座の解説を選びます。乱数関数は再現可能なテスト用に差し替えられます。 */
export function createSeizaResult(argument = '', { randomIntImpl = randomInt } = {}) {
  const input = normalizedInput(argument);
  let constellation;
  if (input) {
    constellation = resolveConstellation(input);
    if (!constellation) {
      return { ok: false, error: `使用方法：/seiza [88星座名]（例：/seiza オリオン座）。「座」は省略できます。` };
    }
  } else {
    constellation = pickRandom(CONSTELLATIONS, randomIntImpl);
  }

  if (!constellation) return { ok: false, error: '星座の解説を選べませんでした。' };
  const message = `${constellation.name}：${constellation.description}`;
  if (!fitsChat(message)) return { ok: false, error: '星座の解説を作成できませんでした。' };
  return { ok: true, constellation, name: constellation.name, description: constellation.description, message };
}

/** 12星座から星座占いの短い一言を選びます。 */
export function createHoroscopeResult(argument = '', { randomIntImpl = randomInt } = {}) {
  const input = normalizedInput(argument);
  let sign;
  if (input) {
    sign = resolveZodiacSign(input);
    if (!sign) {
      return { ok: false, error: `使用方法：/uranai [12星座]（例：/uranai 牡羊座）。指定できる星座：${ZODIAC_SIGNS.join('・')}` };
    }
  } else {
    sign = pickRandom(ZODIAC_SIGNS, randomIntImpl);
  }

  const aside = sign ? pickRandom(HOROSCOPE_ASIDES[sign], randomIntImpl) : null;
  if (!sign || !aside) return { ok: false, error: '星座占いのひとことを作成できませんでした。' };
  const message = `${sign}の占い：${aside}`;
  if (!fitsChat(message)) return { ok: false, error: '星座占いのひとことを作成できませんでした。' };
  return { ok: true, sign, message };
}

/** 運勢・ひとこと・今日の小さな提案を選びます。 */
export function createOmikujiResult({ randomIntImpl = randomInt } = {}) {
  const result = pickRandom(OMIKUJI_RESULTS, randomIntImpl);
  if (!result) return { ok: false, error: 'おみくじの結果を選べませんでした。' };
  const message = `${result.fortune}｜ひとこと：${result.comment}今日の提案：${result.suggestion}`;
  if (!fitsChat(message)) return { ok: false, error: 'おみくじの結果を作成できませんでした。' };
  return { ok: true, ...result, message };
}
