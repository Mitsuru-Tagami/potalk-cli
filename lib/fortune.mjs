import { randomInt } from 'node:crypto';
import { CHAT_MAX } from './config.mjs';

export const ZODIAC_SIGNS = Object.freeze([
  '牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座',
  '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座'
]);

// いずれもこのプロジェクトのために書き起こした、気軽な一言です。
const SEIZA_ASIDES = Object.freeze({
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

function resolveSign(argument) {
  const input = String(argument ?? '').trim().normalize('NFKC');
  if (!input) return null;
  return ZODIAC_SIGNS.find(sign => sign === input || sign.slice(0, -1) === input) ?? undefined;
}

/** 星座と独自の短い一言を選びます。乱数関数は再現可能なテスト用に差し替えられます。 */
export function createSeizaResult(argument = '', { randomIntImpl = randomInt } = {}) {
  const input = String(argument ?? '').trim();
  let sign;
  if (input) {
    sign = resolveSign(input);
    if (!sign) {
      return { ok: false, error: `使用方法：/seiza [星座]（例：/seiza 牡羊座）。指定できる星座：${ZODIAC_SIGNS.join('・')}` };
    }
  } else {
    sign = pickRandom(ZODIAC_SIGNS, randomIntImpl);
  }

  const aside = sign ? pickRandom(SEIZA_ASIDES[sign], randomIntImpl) : null;
  if (!sign || !aside) return { ok: false, error: '星座のひとことを作成できませんでした。' };
  const message = `${sign}：${aside}`;
  if (!fitsChat(message)) return { ok: false, error: '星座のひとことを作成できませんでした。' };
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
