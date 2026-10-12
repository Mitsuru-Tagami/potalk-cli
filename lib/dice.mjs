import { randomInt } from 'node:crypto';

export const DEFAULT_DICE_SIDES = 6;
// crypto.randomInt requires a range smaller than 2^48.
export const MAX_DICE_SIDES = (2 ** 48) - 1;

/**
 * 指定された面数で1からのダイスロールを行います。
 * @param {string|number|null|undefined} argument
 * @param {{randomIntImpl?: (min:number, max:number)=>number}} [options]
 * @returns {{ok:true,sides:number,result:number}|{ok:false,error:string}}
 */
export function rollDice(argument = '', { randomIntImpl = randomInt } = {}) {
  const input = String(argument ?? '').trim();
  let sides = DEFAULT_DICE_SIDES;

  if (input) {
    if (!/^[0-9]+$/u.test(input)) {
      return { ok: false, error: '使用方法：/dice [面数]（面数は1以上の整数、例：/dice 20）' };
    }
    sides = Number(input);
    if (!Number.isSafeInteger(sides) || sides < 1 || sides > MAX_DICE_SIDES) {
      return { ok: false, error: `面数は1〜${MAX_DICE_SIDES}の整数で指定してください。` };
    }
  }

  return { ok: true, sides, result: randomIntImpl(1, sides + 1) };
}

export function formatDiceResult({ sides, result }) {
  return `🎲 ${sides}面ダイス: ${result}`;
}
