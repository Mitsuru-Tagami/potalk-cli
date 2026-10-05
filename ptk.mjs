#!/usr/bin/env node
// ptk ── ぽっと通話 CLI のエントリーポイント（コマンドの振り分け）

const HELP = `ぽっと通話 CLI (ptk)

使い方:
  ptk                 ロビーを TUI で表示する（= ptk lobby）。部屋を選んで Enter で入る
  ptk lobby | ロビー   同上
  ptk list  | 一覧     通話中の部屋を一覧で出力する（--seconds N で待ち時間、既定 15）
  ptk join  | 参加する [招待リンク|部屋ID]
                      部屋に入る（引数なしならロビーから番号で選ぶ）
  ptk create | 部屋をつくる 部屋名
                      新しい部屋を作って入る
  ptk help  | --help  このヘルプ

  lobby / join / create のオプション: --name 名前（既定 ゲスト）  --emoji 絵文字（既定 ⌨️）
                              --no-sound 音を鳴らさない（鳴らすには sox が必要）
  部屋の中では /who で参加者、/mute で音を消す・戻す、/q で退出。話す・書き込むはまだできません。
`;

// `ptk --name 名前` のようにオプションだけなら、コマンドは lobby（--help / -h はそのまま help へ）
const argv = process.argv.slice(2);
const bare = !argv.length || (argv[0].startsWith('-') && !['--help', '-h'].includes(argv[0]));
const cmd = bare ? 'lobby' : argv[0];
const rest = bare ? argv : argv.slice(1);

const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
};

// 名乗り（--name / --emoji）。本家と同じ上限で切り詰める
const profileFromOpts = async () => {
  const { capText } = await import('./lib/text.mjs');
  return { name: capText(opt('name', 'ゲスト'), 20) || 'ゲスト', emoji: capText(opt('emoji', '⌨️'), 8) || '⌨️' };
};

switch (cmd) {
  case 'lobby':
  case 'ロビー':
    await (await import('./commands/lobby.mjs')).runLobby({ profile: await profileFromOpts(), sound: !rest.includes('--no-sound') });
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
    const FLAGS = ['--no-sound'];   // 値を取らないオプション
    const arg = rest.find((a, i) => !a.startsWith('--') && !(rest[i - 1]?.startsWith('--') && !FLAGS.includes(rest[i - 1])));
    if (creating && !arg) { console.error('部屋名を指定してください: ptk create 部屋名'); process.exit(1); }
    await (await import('./commands/join.mjs')).runJoin({ ref: creating ? null : arg, create: creating ? arg : null, profile: await profileFromOpts(), sound: !rest.includes('--no-sound') });
    break;
  }
  default:
    console.error(`不明なコマンド: ${cmd}\n`);
    console.error(HELP);
    process.exit(1);
}
