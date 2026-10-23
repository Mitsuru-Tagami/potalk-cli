import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CHAT_MAX } from './config.mjs';
import { UNSAFE_CHARS } from './text.mjs';

const WAKA_SUFFIX = ' — {author}〔古今集・国文研〕';
const HAIKU_SUFFIX = ' — 正岡子規〔松山市・子規俳句〕';

const oneLine = value => String(value ?? '')
  .replace(/[\r\n\u2028\u2029]/gu, ' ')
  .replace(UNSAFE_CHARS, ' ')
  .replace(/\s+/gu, ' ')
  .trim();

function formatPoem(entry, suffix) {
  if (!entry || typeof entry !== 'object') return null;
  const text = oneLine(entry.text);
  const author = oneLine(entry.author);
  if (!text || !author) return null;
  const message = `${text}${suffix.replace('{author}', author)}`;
  // CHAT_MAX is measured in Unicode code points by capText; reject instead of truncating.
  return [...message].length <= CHAT_MAX && !/[\r\n\u2028\u2029]/u.test(message) ? message : null;
}

export const formatWaka = entry => formatPoem(entry, WAKA_SUFFIX);
export const formatHaiku = entry => formatPoem(entry, HAIKU_SUFFIX);

/** Pick one item by a uniformly random index. The RNG is injectable for deterministic tests. */
export function pickRandomPoem(poems, randomIntImpl = randomInt) {
  if (!Array.isArray(poems) || poems.length === 0) return null;
  const index = randomIntImpl(0, poems.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= poems.length) return null;
  return poems[index];
}

let wakaEntries;
let haikuEntries;
function loadEntries(filename, formatter) {
  const parsed = JSON.parse(readFileSync(new URL(`../data/${filename}`, import.meta.url), 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError(`${filename} must contain a JSON array`);
  return Object.freeze(parsed.filter(entry => formatter(entry) !== null).map(entry => Object.freeze(entry)));
}

function wakaPool() {
  wakaEntries ??= loadEntries('kokin-wakashu.json', formatWaka);
  return wakaEntries;
}

function haikuPool() {
  haikuEntries ??= loadEntries('shiki-haiku.json', formatHaiku);
  return haikuEntries;
}

export function selectRandomWaka(randomIntImpl = randomInt) {
  const entry = pickRandomPoem(wakaPool(), randomIntImpl);
  return entry ? formatWaka(entry) : null;
}

export function selectRandomHaiku(randomIntImpl = randomInt) {
  const entry = pickRandomPoem(haikuPool(), randomIntImpl);
  return entry ? formatHaiku(entry) : null;
}

export function poemDataCounts() {
  return Object.freeze({ waka: wakaPool().length, haiku: haikuPool().length });
}
