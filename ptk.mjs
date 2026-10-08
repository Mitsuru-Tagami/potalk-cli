#!/usr/bin/env node
// ptk ── ぽっと通話 CLI のエントリーポイント（コマンドの振り分け）

const HELP = `ぽっと通話 CLI (ptk)

使い方:
  ptk                 ロビーを TUI で表示する（= ptk lobby）。部屋を選んで Enter で入る
  ptk lobby | ロビー   同上
  ptk list  | 一覧     通話中の部屋を一覧で出力する（--seconds N で待ち時間、既定 15）
  ptk join  | 参加する [招待リンク|部屋ID|部屋名の一部]
                      部屋に入る（引数なしならロビーから番号で選ぶ。
                      名前の一部なら、合う部屋が 1 つでそのまま入り、複数なら番号で選ぶ）
  ptk create | 部屋をつくる [部屋名]
                      新しい部屋を作って入る（部屋名を省くと「あなたの名前の部屋」）
  ptk help  | --help  このヘルプ

  lobby / join / create のオプション: --name 名前  --emoji 絵文字
                              一度付ければ覚えて、次からはそれを使う
                              （最初は「深煎りキリマンジャロ」のようなコーヒーの名前を自動で付ける）
                              --no-sound 音を鳴らさない（鳴らすには sox が必要）
  部屋の中では、文字を打って Enter でひとことを送る（TUI は i で入力欄へ）。
  マイクは入るときオフ。TUI は t、行表示は /mic でオン/オフ（ヘッドホン推奨）。
  /tag 話題を変える（/notag で消す）　/list ほかの部屋を見る
  /who 参加者（行表示）　/mute 音を消す・戻す　/q 退出。
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

// 名乗り。前回覚えたもの（~/.config/ptk/profile.json）に --name / --emoji を重ね、付いていれば覚え直す
const profileFromOpts = async () => {
  const { resolveProfile, profilePath } = await import('./lib/profile.mjs');
  const r = resolveProfile({ name: opt('name', undefined), emoji: opt('emoji', undefined) });
  const notice = r.saved ? `📝 名乗りを覚えました：${r.profile.emoji}${r.profile.name}（次からは --name なしでこの名前です）`
    : r.error ? `（名乗りを保存できませんでした：${profilePath()}：${r.error}）` : '';
  return { profile: r.profile, notice };
};

switch (cmd) {
  case 'lobby':
  case 'ロビー':
    await (await import('./commands/lobby.mjs')).runLobby({ ...await profileFromOpts(), sound: !rest.includes('--no-sound') });
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
    const { profile, notice } = await profileFromOpts();
    if (notice) console.error(notice);
    // 部屋名を付けずに作るときは「名前の部屋」（本家の defaultRoom と同じ）
    const create = creating ? (arg || `${profile.name}の部屋`) : null;
    await (await import('./commands/join.mjs')).runJoin({ ref: creating ? null : arg, create, profile, sound: !rest.includes('--no-sound') });
    break;
  }
  default:
    console.error(`不明なコマンド: ${cmd}\n`);
    console.error(HELP);
    process.exit(1);
}
