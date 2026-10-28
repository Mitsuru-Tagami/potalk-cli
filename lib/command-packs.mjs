/**
 * 外部コマンドパック（契約 potalk-command-v1、データのみ型）の読み込みと実行。
 *
 * パックはコードを持たず、command.json（マニフェスト）と data/*.json（プール）だけで
 * 構成される。本体側のエンジン（pool / combo / dice）が解釈して1行の文を作る。
 * 形式の後方互換が原則：項目の追加はよいが、既存項目・既存エンジンの意味は変えない。
 * （Issue #69）
 */
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CHAT_MAX } from './config.mjs';
import { UNSAFE_CHARS } from './text.mjs';
import { formatDiceResult, rollDice } from './dice.mjs';

export const COMMAND_CONTRACT = 'potalk-command-v1';
export const PACK_ENGINES = Object.freeze(['pool', 'combo', 'dice']);
const MAX_POOL_ENTRIES = 10000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const oneLine = value => String(value ?? '')
  .replace(/[\r\n\u2028\u2029]/gu, ' ')
  .replace(UNSAFE_CHARS, ' ')
  .replace(/\s+/gu, ' ')
  .trim();

const fitsChat = message => [...message].length <= CHAT_MAX && !/[\r\n\u2028\u2029]/u.test(message);

function pickRandom(items, randomIntImpl) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = randomIntImpl(0, items.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) return null;
  return items[index];
}

/** {field} 形式のプレースホルダを、値（1行化済み）で置き換える。無い欄は空文字。 */
function applyFormat(format, values) {
  return String(format).replace(/\{([a-zA-Z0-9_]+)\}/gu, (_m, key) => oneLine(values[key] ?? ''));
}

/** マニフェストの形を検証する。データファイルの中身までは見ない。 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['command.json がオブジェクトではありません'] };
  }
  if (manifest.contract !== COMMAND_CONTRACT) {
    errors.push(`contract は ${COMMAND_CONTRACT} でなければなりません（実際：${String(manifest.contract)}）`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(String(manifest.name ?? ''))) {
    errors.push('name は半角英小文字・数字・ハイフンの名前でなければなりません');
  }
  for (const field of ['title', 'author', 'version']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) errors.push(`${field} が空です`);
  }
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    errors.push('commands が空です');
    return { ok: false, errors };
  }
  const seen = new Set();
  manifest.commands.forEach((cmd, i) => {
    const at = `commands[${i}]`;
    if (!cmd || typeof cmd !== 'object') { errors.push(`${at} がオブジェクトではありません`); return; }
    if (!/^\/[a-z0-9-]+$/u.test(String(cmd.name ?? ''))) errors.push(`${at}.name は / で始まる半角のコマンド名でなければなりません`);
    if (seen.has(cmd.name)) errors.push(`${at}.name が重複しています：${cmd.name}`);
    seen.add(cmd.name);
    if (typeof cmd.description !== 'string' || !cmd.description.trim()) errors.push(`${at}.description が空です`);
    if (!PACK_ENGINES.includes(cmd.engine)) { errors.push(`${at}.engine が不正です：${String(cmd.engine)}`); return; }
    if (cmd.engine === 'pool') {
      if (typeof cmd.pool !== 'string' || !cmd.pool) errors.push(`${at}.pool が必要です`);
      if (typeof cmd.format !== 'string' || !/\{[a-zA-Z0-9_]+\}/u.test(cmd.format)) errors.push(`${at}.format に {欄} が必要です`);
    }
    if (cmd.engine === 'combo') {
      if (!cmd.pools || typeof cmd.pools !== 'object' || Object.keys(cmd.pools).length === 0) errors.push(`${at}.pools が必要です`);
      if (typeof cmd.format !== 'string' || !/\{[a-zA-Z0-9_]+\}/u.test(cmd.format)) errors.push(`${at}.format に {欄} が必要です`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** パックフォルダ内の相対パスだけを許可する（フォルダ外参照の禁止）。 */
function resolveInside(dir, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  const resolved = path.resolve(dir, rel);
  const base = path.resolve(dir);
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}

function readJsonInside(dir, rel, errors, label) {
  const file = resolveInside(dir, rel);
  if (!file) { errors.push(`${label}：パックフォルダ外は参照できません（${String(rel)}）`); return null; }
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    errors.push(`${label}：ファイルが読めません（${String(rel)}）`);
    return null;
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) { errors.push(`${label}：ファイルが大きすぎます（${String(rel)}）`); return null; }
  try {
    return JSON.parse(raw);
  } catch {
    errors.push(`${label}：JSON として読めません（${String(rel)}）`);
    return null;
  }
}

function checkPoolShape(pool, errors, label) {
  if (!Array.isArray(pool)) { errors.push(`${label}：プールは JSON 配列でなければなりません`); return false; }
  if (pool.length === 0) { errors.push(`${label}：プールが空です`); return false; }
  if (pool.length > MAX_POOL_ENTRIES) { errors.push(`${label}：プールが大きすぎます（上限 ${MAX_POOL_ENTRIES} 件）`); return false; }
  return true;
}

/**
 * パックフォルダを読み込み、検証済みのパックオブジェクトを返す。
 * 失敗した場合は errors に理由を集めて返し、例外は投げない（本体を止めないため）。
 */
export function loadPackFromDir(dir) {
  const errors = [];
  const manifest = readJsonInside(dir, 'command.json', errors, 'command.json');
  if (!manifest) return { ok: false, errors };
  const v = validateManifest(manifest);
  if (!v.ok) return { ok: false, errors: v.errors };

  const pools = new Map(); // 相対パス -> 配列
  const loadPool = rel => {
    if (pools.has(rel)) return pools.get(rel);
    const pool = readJsonInside(dir, rel, errors, `プール ${String(rel)}`);
    if (pool !== null && checkPoolShape(pool, errors, `プール ${String(rel)}`)) pools.set(rel, pool);
    else pools.set(rel, null);
    return pools.get(rel);
  };
  for (const cmd of manifest.commands) {
    if (cmd.engine === 'pool') loadPool(cmd.pool);
    if (cmd.engine === 'combo') {
      for (const spec of Object.values(cmd.pools)) loadPool(typeof spec === 'string' ? spec : spec && spec.file);
    }
  }
  if (errors.length) return { ok: false, errors };

  const pack = Object.freeze({
    name: manifest.name,
    title: manifest.title,
    author: manifest.author,
    version: manifest.version,
    dir,
    manifest,
    pools,
  });
  return { ok: true, pack };
}

/** ヘルプ・補完に載せるためのコマンド一覧。 */
export function listPackCommands(pack) {
  return (pack?.manifest?.commands ?? []).map(cmd => ({
    name: cmd.name,
    usage: typeof cmd.usage === 'string' && cmd.usage ? cmd.usage : cmd.name,
    description: cmd.description,
  }));
}

const normalizeKey = value => String(value ?? '').trim().normalize('NFKC');

/**
 * キー引き：引数を、欄（field）・別名（aliasesField）・追加欄（extraFields）と照合する。
 * stripSuffix があれば末尾のその文字を落としてから比べる（「座」の省略対応）。
 * 英字の追加欄は大文字小文字を区別しない。
 */
function resolveByKey(entries, cmd, arg) {
  const key = cmd.key ?? {};
  const field = key.field ?? 'name';
  const aliasesField = key.aliasesField ?? 'aliases';
  const extraFields = Array.isArray(key.extraFields) ? key.extraFields : [];
  const strip = typeof key.stripSuffix === 'string' ? key.stripSuffix : '';
  const stripOf = s => (strip && s.endsWith(strip) ? s.slice(0, -strip.length) : s);
  const input = stripOf(normalizeKey(arg));
  if (!input) return null;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const candidates = [entry[field], ...(Array.isArray(entry[aliasesField]) ? entry[aliasesField] : [])];
    if (candidates.some(c => typeof c === 'string' && stripOf(normalizeKey(c)) === input)) return entry;
    if (extraFields.some(f => typeof entry[f] === 'string' && entry[f].toLocaleLowerCase('en') === normalizeKey(arg).toLocaleLowerCase('en'))) return entry;
  }
  return undefined; // 「引数はあるが見つからない」を null（引数なし）と区別する
}

function runPool(pack, cmd, arg, randomIntImpl) {
  const entries = pack.pools.get(cmd.pool);
  if (!entries) return { ok: false, error: 'プールを読み込めませんでした。' };
  let entry;
  if (String(arg ?? '').trim()) {
    if (!cmd.key) return { ok: false, error: cmd.errorUsage ?? `使用方法：${cmd.usage ?? cmd.name}` };
    entry = resolveByKey(entries, cmd, arg);
    if (entry === undefined) return { ok: false, error: cmd.errorUsage ?? `使用方法：${cmd.usage ?? cmd.name}` };
  } else {
    entry = pickRandom(entries, randomIntImpl);
  }
  if (!entry || typeof entry !== 'object') return { ok: false, error: '結果を選べませんでした。' };
  // グループ引き：entry.items があれば、その中からも1件引いて {item} として使えるようにする
  const values = { ...entry };
  if (Array.isArray(entry.items)) {
    const item = pickRandom(entry.items, randomIntImpl);
    if (item == null) return { ok: false, error: '結果を選べませんでした。' };
    if (typeof item === 'object') Object.assign(values, item);
    else values.item = item;
    delete values.items;
  }
  const message = applyFormat(cmd.format, values);
  if (!fitsChat(message)) return { ok: false, error: '結果を作成できませんでした。' };
  return { ok: true, message };
}

function runCombo(pack, cmd, _arg, randomIntImpl) {
  const values = {};
  for (const [slot, spec] of Object.entries(cmd.pools)) {
    const isObj = spec && typeof spec === 'object';
    const rel = isObj ? spec.file : spec;
    const rate = isObj && typeof spec.rate === 'number' ? spec.rate : null;
    if (rate !== null && randomIntImpl(0, 10000) / 10000 >= rate) { values[slot] = ''; continue; }
    const pool = pack.pools.get(rel);
    if (!pool) return { ok: false, error: 'プールを読み込めませんでした。' };
    const picked = pickRandom(pool, randomIntImpl);
    if (picked == null) return { ok: false, error: '結果を選べませんでした。' };
    values[slot] = typeof picked === 'object' ? (picked.value ?? picked.text ?? '') : picked;
  }
  const message = applyFormat(cmd.format, values);
  if (!fitsChat(message)) return { ok: false, error: '結果を作成できませんでした。' };
  return { ok: true, message };
}

/** パックのコマンドを1つ実行し、部屋に送る1行を返す。 */
export function runPackCommand(pack, commandName, arg = '', { randomIntImpl = randomInt } = {}) {
  const cmd = (pack?.manifest?.commands ?? []).find(c => c.name === commandName);
  if (!cmd) return { ok: false, error: `コマンドが見つかりません：${String(commandName)}` };
  if (cmd.engine === 'dice') {
    const rolled = rollDice(arg);
    if (!rolled.ok) return rolled;
    const message = cmd.format ? applyFormat(cmd.format, rolled) : formatDiceResult(rolled);
    return fitsChat(message) ? { ok: true, message } : { ok: false, error: '結果を作成できませんでした。' };
  }
  if (cmd.engine === 'pool') return runPool(pack, cmd, arg, randomIntImpl);
  if (cmd.engine === 'combo') return runCombo(pack, cmd, arg, randomIntImpl);
  return { ok: false, error: `未対応のエンジンです：${String(cmd.engine)}` };
}
