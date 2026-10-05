#!/usr/bin/env node
// ptk ── ぽっと通話 CLI のエントリーポイント（コマンドの振り分け）

const HELP = `ぽっと通話 CLI (ptk)

使い方:
  ptk                 ロビーを TUI で表示する（= ptk lobby）
  ptk lobby | ロビー   同上
  ptk list  | 一覧     通話中の部屋を一覧で出力する（--seconds N で待ち時間、既定 15）
  ptk help  | --help  このヘルプ

まだ無いもの:
  ptk create | 部屋をつくる / ptk join | 参加する
`;

const [cmd = 'lobby', ...rest] = process.argv.slice(2);

const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
};

switch (cmd) {
  case 'lobby':
  case 'ロビー':
    await (await import('./commands/lobby.mjs')).runLobby();
    break;
  case 'list':
  case '一覧':
    await (await import('./commands/list.mjs')).runList({ seconds: Number(opt('seconds', 15)) || 15 });
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  case 'create':
  case '部屋をつくる':
  case 'join':
  case '参加する':
    console.error(`「${cmd}」はまだ実装されていません。`);
    process.exit(1);
  default:
    console.error(`不明なコマンド: ${cmd}\n`);
    console.error(HELP);
    process.exit(1);
}
