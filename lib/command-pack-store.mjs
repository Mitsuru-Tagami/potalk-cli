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
import { ROOM_COMMANDS, setPackCommands } from './commands.mjs';

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
  extraDirs = [],
  activationPath = defaultActivationPath(),
  persistSeen = true,
  enableAllBundled = false,
} = {}) {
  const activation = loadActivation(activationPath);
  const errors = [];
  const notices = [];
  const found = new Map(); // pack.name -> { pack, source }
  // 探索の順＝同名パックの優先順：追加指定（BOT 内蔵など）→同梱→利用者配置
  const sources = [
    ...extraDirs.map(dir => ['extra', dir]),
    ['bundled', bundledDir],
    ['user', userDir],
  ];
  for (const [source, dir] of sources) {
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
  const states = [];
  const sourceOf = new Map();
  for (const { pack, source } of found.values()) {
    sourceOf.set(pack.name, source);
    const isStandard = source === 'bundled' && STANDARD_PACK_NAMES.includes(pack.name);
    if (activation.disabled.includes(pack.name)) {
      states.push({ pack, source, standard: isStandard, state: 'disabled' });
      continue;
    }
    // 追加指定（BOT 内蔵など）は、そのセッションのために用意されたものとして有効化なしで使う
    if (source === 'extra') {
      enabledPacks.push(pack);
      states.push({ pack, source, standard: isStandard, state: 'enabled' });
      continue;
    }
    if (isStandard || (enableAllBundled && source === 'bundled')) {
      enabledPacks.push(pack);
      states.push({ pack, source, standard: isStandard, state: 'enabled' });
      continue;
    }
    const recorded = activation.activated[pack.name];
    if (recorded === pack.version) {
      enabledPacks.push(pack);
      states.push({ pack, source, standard: false, state: 'enabled' });
    } else {
      inactive.push({ pack, source, reason: recorded === undefined ? 'new' : 'updated' });
      states.push({ pack, source, standard: false, state: 'inactive' });
    }
  }

  // 配線：追加指定→標準→その他の順で先勝ち。同名コマンドは警告する。
  // 本体の内蔵コマンドと同名のパックコマンドは、絶対に上書きさせない
  const tier = pack => (sourceOf.get(pack.name) === 'extra' ? 0 : STANDARD_PACK_NAMES.includes(pack.name) ? 1 : 2);
  const ordered = [...enabledPacks].sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name));
  const dispatch = new Map();
  for (const pack of ordered) {
    for (const cmd of pack.manifest.commands) {
      if (ROOM_COMMANDS.includes(cmd.name)) {
        notices.push(`コマンド ${cmd.name} は本体の内蔵コマンドのため、パック『${pack.title}』のものは使いません`);
        continue;
      }
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

  return { dispatch, helpLines, enabledPacks: ordered, inactive, states, startupLines, errors, notices, activation };
}

let shared = null;
/** 既定の置き場所で用意した共有の配線（プロセス内で1回だけ用意する）。 */
export function getSharedCommandPacks() {
  if (!shared) {
    // BOT 内蔵パックなどの追加の置き場所は、環境変数 PTK_COMMAND_PACK_DIRS（区切りは OS のパス区切り）で渡す
    const extraDirs = (process.env.PTK_COMMAND_PACK_DIRS ?? '')
      .split(path.delimiter)
      .map(s => s.trim())
      .filter(Boolean);
    shared = prepareCommandPacks({ extraDirs });
    setPackCommands([...shared.dispatch.keys()]);
  }
  return shared;
}

/**
 * パック1つの状態を切り替える（--commands の実体）。
 * enabled → 標準は disabled へ、それ以外は有効化の記録を消す。
 * inactive → 有効化の記録を書く。disabled → disabled から外す。
 * @returns {string|null} 切り替え後の状態（enabled / inactive / disabled）。見つからなければ null
 */
export function togglePackState(name, opts = {}) {
  const activationPath = opts.activationPath ?? defaultActivationPath();
  const prepared = prepareCommandPacks({ ...opts, persistSeen: false });
  const entry = prepared.states.find(s => s.pack.name === name);
  if (!entry) return null;
  const activation = prepared.activation;
  let next;
  if (entry.state === 'enabled') {
    if (entry.standard || entry.source === 'extra') {
      activation.disabled = [...new Set([...activation.disabled, name])];
    } else {
      delete activation.activated[name];
    }
    next = entry.standard || entry.source === 'extra' ? 'disabled' : 'inactive';
  } else if (entry.state === 'inactive') {
    activation.activated[name] = entry.pack.version;
    activation.seen[name] = entry.pack.version;
    activation.disabled = activation.disabled.filter(n => n !== name);
    next = 'enabled';
  } else {
    activation.disabled = activation.disabled.filter(n => n !== name);
    if (!entry.standard && entry.source !== 'extra' && activation.activated[name] !== entry.pack.version) {
      next = 'inactive';
    } else {
      next = 'enabled';
    }
  }
  saveActivation(activationPath, activation);
  return next;
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
