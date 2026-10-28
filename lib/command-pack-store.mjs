/**
 * コマンドパックの探索・有効化・配線（Issue #69）。
 *
 * 置き場所は2つ：本体同梱（packs/）と、利用者が置く場所（設定ディレクトリの commands/）。
 * - 標準パック（STANDARD_PACK_NAMES、同梱のみ）はインストール作業なしで有効。
 *   ただし activation.disabled にあれば無効にできる。
 * - それ以外のパックは、有効化の記録（名前と version が一致）があるものだけ有効。
 *   未有効化のパックは inactive として返し、呼び出し側が警告と手順を案内する。
 * - 有効化の記録：<設定ディレクトリ>/command-packs.json
 *   { activated: {名前: version}, disabled: [名前], seen: {名前: version} }
 *   seen は「導入ログを出した版」の記録で、起動時の導入表示を1回きりにするために使う。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackCommands, loadPackFromDir } from './command-packs.mjs';
import { setPackCommands } from './commands.mjs';

export const STANDARD_PACK_NAMES = Object.freeze(['omikuji', 'dice']);
const HELP_ORDER = ['/dice', '/waka', '/haiku', '/seiza', '/uranai', '/omikuji', '/waza'];

export const configDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ptk');
export const defaultBundledPacksDir = () => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packs');
export const defaultUserPacksDir = () => path.join(configDir(), 'commands');
export const defaultActivationPath = () => path.join(configDir(), 'command-packs.json');

export function loadActivation(file = defaultActivationPath()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      return {
        activated: parsed.activated && typeof parsed.activated === 'object' ? parsed.activated : {},
        disabled: Array.isArray(parsed.disabled) ? parsed.disabled.filter(x => typeof x === 'string') : [],
        seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
      };
    }
  } catch { /* 無い・壊れている場合は空として扱う */ }
  return { activated: {}, disabled: [], seen: {} };
}

export function saveActivation(file, activation) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(activation, null, 2) + '\n');
}

function scanPackDirs(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(dir, e.name))
    .sort();
}

/**
 * パックを集めて、有効なコマンドの配線（dispatch）を作る。
 * @returns {{
 *   dispatch: Map<string, {pack: object, cmd: object}>,
 *   helpLines: string[],
 *   enabledPacks: object[],
 *   inactive: {pack: object, source: string, reason: 'new'|'updated'}[],
 *   startupLines: string[],
 *   errors: string[],
 * }}
 */
export function prepareCommandPacks({
  bundledDir = defaultBundledPacksDir(),
  userDir = defaultUserPacksDir(),
  activationPath = defaultActivationPath(),
  persistSeen = true,
  enableAllBundled = false,
} = {}) {
  const activation = loadActivation(activationPath);
  const errors = [];
  const notices = [];
  const found = new Map(); // pack.name -> { pack, source }
  for (const [source, dir] of [['bundled', bundledDir], ['user', userDir]]) {
    for (const packDir of scanPackDirs(dir)) {
      const result = loadPackFromDir(packDir);
      if (!result.ok) {
        errors.push(`コマンドパックを読み込めませんでした（${packDir}）：${result.errors.join('／')}`);
        continue;
      }
      if (found.has(result.pack.name)) {
        notices.push(`コマンドパック『${result.pack.title}』が重複しているため、${source === 'user' ? '同梱側' : '先に見つけた方'}を優先します`);
        continue;
      }
      found.set(result.pack.name, { pack: result.pack, source });
    }
  }

  const enabledPacks = [];
  const inactive = [];
  for (const { pack, source } of found.values()) {
    const isStandard = source === 'bundled' && STANDARD_PACK_NAMES.includes(pack.name);
    if (isStandard) {
      if (!activation.disabled.includes(pack.name)) enabledPacks.push(pack);
      continue;
    }
    if (enableAllBundled && source === 'bundled') { enabledPacks.push(pack); continue; }
    const recorded = activation.activated[pack.name];
    if (recorded === pack.version) enabledPacks.push(pack);
    else inactive.push({ pack, source, reason: recorded === undefined ? 'new' : 'updated' });
  }

  // 配線：標準→同梱拡張→利用者配置の順で、先勝ち。同名は警告する
  const tier = pack => (STANDARD_PACK_NAMES.includes(pack.name) ? 0 : 1);
  const ordered = [...enabledPacks].sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name));
  const dispatch = new Map();
  for (const pack of ordered) {
    for (const cmd of pack.manifest.commands) {
      if (dispatch.has(cmd.name)) {
        notices.push(`コマンド ${cmd.name} が複数のパックにあるため、先に有効になった『${dispatch.get(cmd.name).pack.title}』を優先します`);
        continue;
      }
      dispatch.set(cmd.name, { pack, cmd });
    }
  }

  // /help の行（従来の並びを保ち、新顔は後ろへ）
  const helpEntries = [...dispatch.values()].map(({ cmd }) => ({
    usage: cmd.usage ?? cmd.name,
    description: cmd.description,
    order: HELP_ORDER.includes(cmd.name) ? HELP_ORDER.indexOf(cmd.name) : HELP_ORDER.length,
    name: cmd.name,
  })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const helpLines = helpEntries.map(e => `   ${e.usage.padEnd(13)}: ${e.description}`);

  // 起動時の表示：新しく有効になった（版が変わった）パックの導入ログ＋未有効化の警告
  const startupLines = [];
  let seenChanged = false;
  for (const pack of ordered) {
    if (activation.seen[pack.name] !== pack.version) {
      const cmds = listPackCommands(pack).map(c => c.name).join(' ');
      const kind = STANDARD_PACK_NAMES.includes(pack.name) ? '標準コマンド' : '追加コマンド';
      startupLines.push(`${kind}：${cmds}（${pack.title}／${pack.author}）を導入しました`);
      activation.seen[pack.name] = pack.version;
      seenChanged = true;
    }
  }
  for (const { pack, reason } of inactive) {
    startupLines.push(reason === 'updated'
      ? `⚠ 追加コマンドパック『${pack.title}』が更新されました。再度有効化するには ptk --install-commands を実行してください`
      : `⚠ 追加コマンドパック『${pack.title}』を見つけましたが、有効化されていません。有効化するには ptk --install-commands を実行してください`);
  }
  if (persistSeen && seenChanged) {
    try { saveActivation(activationPath, activation); } catch { /* 保存できなくても起動は続ける */ }
  }

  return { dispatch, helpLines, enabledPacks: ordered, inactive, startupLines, errors, notices, activation };
}

let shared = null;
/** 既定の置き場所で用意した共有の配線（プロセス内で1回だけ用意する）。 */
export function getSharedCommandPacks() {
  if (!shared) {
    shared = prepareCommandPacks();
    setPackCommands([...shared.dispatch.keys()]);
  }
  return shared;
}

/** 未有効化のパックをすべて有効化し、記録する。--install-commands の実体。 */
export function activateInactivePacks(opts = {}) {
  const activationPath = opts.activationPath ?? defaultActivationPath();
  const prepared = prepareCommandPacks({ ...opts, persistSeen: false });
  const activation = loadActivation(activationPath);
  const lines = [];
  for (const { pack } of prepared.inactive) {
    activation.activated[pack.name] = pack.version;
    activation.seen[pack.name] = pack.version;
    const cmds = listPackCommands(pack).map(c => c.name).join(' ');
    lines.push(`追加コマンド：${cmds}（${pack.title}／${pack.author}）を導入しました`);
  }
  if (prepared.inactive.length) saveActivation(activationPath, activation);
  return { activated: prepared.inactive.map(x => x.pack), lines, errors: prepared.errors };
}
