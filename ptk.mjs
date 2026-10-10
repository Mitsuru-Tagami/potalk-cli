#!/usr/bin/env node
/**
 * @fileoverview ptk ── ぽっと通話 CLI のエントリーポイント（コマンドの振り分け）
 * CLIの起動時引数をパースし、各コマンド（lobby, list, join, create）へディスパッチします。
 *
 * 【今後の拡張ポイント】
 * - Commander.jsやYargsなどのCLI引数解析ライブラリの導入による高度なオプション管理
 * - 独自設定ファイル（~/.config/ptk/config.jsonなど）からのデフォルト設定読み込み
 * - /helpの多言語対応やカラー化
 */


const HELP = `
🫖  POT-TALK CLI (ptk) - ハッカーのためのP2P音声通話

【 起動コマンド 】
  ptk                 ロビーを TUI で表示する（'ptk lobby' と同じ）
  ptk lobby | ロビー  ロビー画面を開き、部屋を選んで入室する
  ptk list  | 一覧    通話中の部屋を一覧で出力する（--seconds N で待ち時間、既定 15）
  ptk join  | 参加    [招待リンク|部屋ID|部屋名の一部] を指定して部屋に入る
                      （引数なしならロビーから番号で選択）
  ptk create| 作成    [部屋名] 新しい部屋を作って入る（省略時は「あなたの名前の部屋」）
  ptk help  | --help  このヘルプを表示する

【 オプション設定 】
  --name <名前>       あなたの表示名を設定する
  --emoji <絵文字>    あなたの絵文字を設定する
                      ※一度設定すれば次回以降も記憶して使用します。
                      ※未設定の初回起動時は「深煎りキリマンジャロ」のような
                        コーヒー銘柄の匿名ネームが自動で割り当てられます！
  --no-sound          音声を再生しない（ミュートモード。鳴らすにはsoxが必要）

【 通話中のチャットコマンド (部屋内で使用) 】
  /help         コマンド一覧とヘルプを表示する
  /tag <話題>   部屋の話題（タグ）を変更する（/notag で消去）
  /list         現在の部屋にいながら、他のアクティブな部屋一覧を見る
  /who          現在の参加者一覧を表示する（行表示モード時）
  /mic          マイクのON/OFFを切り替える (TUIでは 't' キー)
  /mute         スピーカーのON/OFFを切り替える (TUIでは 'm' キー)
  /q, /quit     部屋から退出する (TUIでは 'q' キー)
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
  case '参加':
  case 'create':
  case '部屋をつくる':
  case '作成': {
    const creating = cmd === 'create' || cmd === '部屋をつくる' || cmd === '作成';
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
