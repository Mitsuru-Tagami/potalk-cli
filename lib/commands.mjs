/**
 * 部屋内で利用できるコマンド名と入力補完を管理します。
 * readline と Blessed TUI の両方から同じ候補一覧を利用します。
 */
export const ROOM_COMMANDS = Object.freeze([
  '/help', '/tag', '/notag', '/list', '/who', '/card', '/hbk', '/unhbk',
  '/mic', '/mute', '/cp', '/copy', '/q', '/quit'
]);

// ランダム系などのコマンドは外部パックが提供する（Issue #69）。
// 有効化されたパックのコマンド名を、補完候補へ足すために受け取る。
let packCommandNames = [];
export function setPackCommands(names) {
  packCommandNames = Array.isArray(names) ? names.filter(n => typeof n === 'string' && n.startsWith('/')) : [];
}
export function allRoomCommands() {
  return [...ROOM_COMMANDS, ...packCommandNames.filter(n => !ROOM_COMMANDS.includes(n))];
}

/**
 * コマンド名だけを補完候補として返します。引数入力中は補完しません。
 * @param {string} line - 現在の入力行
 * @returns {string[]}
 */
export function roomCommandMatches(line) {
  const input = String(line ?? '');
  if (!input.startsWith('/') || /\s/.test(input)) return [];
  return allRoomCommands().filter(command => command.startsWith(input));
}

/** readline の completer として使える形式で返します。 */
export function completeRoomCommand(line) {
  const input = String(line ?? '');
  return [roomCommandMatches(input), input];
}

/** 候補文字列の最長共通接頭辞を返します。 */
export function commonCommandPrefix(matches) {
  if (!matches.length) return '';
  let prefix = matches[0];
  for (const match of matches.slice(1)) {
    while (!match.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
