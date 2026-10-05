#!/usr/bin/env node
// ptk ── ぽっと通話 CLI のエントリーポイント（コマンドの振り分け）

const HELP = `ぽっと通話 CLI (ptk)

使い方:
  ptk                 ロビーを TUI で表示する（= ptk lobby）
  ptk lobby | ロビー   同上
  ptk list  | 一覧     通話中の部屋を一覧で出力する（--seconds N で待ち時間、既定 15）
  ptk join  | 参加する [招待リンク|部屋ID]
                      部屋に入る（引数なしならロビーから番号で選ぶ）
  ptk create | 部屋をつくる 部屋名
                      新しい部屋を作って入る
  ptk help  | --help  このヘルプ

  join / create のオプション: --name 名前（既定 ゲスト）  --emoji 絵文字（既定 ⌨️）
  部屋の中では /who で参加者、/q で退出。話す・書き込むはまだできません。
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
  case 'join':
  case '参加する':
  case 'create':
  case '部屋をつくる': {
    const creating = cmd === 'create' || cmd === '部屋をつくる';
    const arg = rest.find((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
    if (creating && !arg) { console.error('部屋名を指定してください: ptk create 部屋名'); process.exit(1); }
    const { capText } = await import('./lib/text.mjs');
    const profile = { name: capText(opt('name', 'ゲスト'), 20), emoji: capText(opt('emoji', '⌨️'), 8) || '⌨️' };
    await (await import('./commands/join.mjs')).runJoin({ ref: creating ? null : arg, create: creating ? arg : null, profile });
    break;
  }
  default:
    console.error(`不明なコマンド: ${cmd}\n`);
    console.error(HELP);
    process.exit(1);
}
