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
import { parseCliArgs, parseLobbyOptions, findRoomArgument } from './lib/cli-args.mjs';
import { BOT_AUDIO_PIPEWIRE_CAPABILITY, parseBotAudioSource, parseBotAudioPipewire } from './lib/bot-audio.mjs';

if (process.argv[2] === '--check-pipewire') {
  process.stdout.write(BOT_AUDIO_PIPEWIRE_CAPABILITY);
  process.exit(0);
}


const HELP = `
🫖  POT-TALK CLI (ptk) - ハッカーのためのP2P音声通話

【 起動コマンド 】
  ptk                 ロビーを TUI で表示する（'ptk lobby' と同じ）
  ptk lobby | ロビー  ロビー画面を開き、部屋を選んで入室する
  ptk list  | 一覧    通話中の部屋を一覧で出力する（--seconds N で待ち時間、既定 15）
  ptk join  | 参加    [招待リンク|部屋ID|部屋名の一部] を指定して部屋に入る
                      （--events-jsonl で受信コメントと既知参加者の入退室をJSON Linesで出力）
                      （引数なしならロビーから番号で選択）
  ptk create| 作成    [部屋名] 新しい部屋を作って入る（省略時は「あなたの名前の部屋」）
  ptk help  | --help  このヘルプを表示する
  ptk --mic-test      既定マイクを5秒テスト（録音を保存せず、可能なら再生）

【 オプション設定 】
  --name <名前>       あなたの表示名を設定する
  --emoji <絵文字>    あなたの絵文字を設定する
                      ※一度設定すれば次回以降も記憶して使用します。
                      ※未設定の初回起動時は「深煎りキリマンジャロ」のような
                        コーヒー銘柄の匿名ネームが自動で割り当てられます！
  --no-sound          音声を再生しない（ミュートモード。鳴らすにはsoxが必要）
  --events-jsonl      受信コメントと既知参加者の入退室をJSON Linesで標準出力へ出し、画面表示は標準エラーへ
  --tts <コマンド>    受信コメント本文を外部TTSコマンドへ非同期で渡す（例: 'espeak-ng -v ja'）
  --bot-audio-source <BotSink_X.monitor>  BOT入力のPulseAudio monitor契約名
  --bot-audio-pipewire  BOT入力を指定serialのPipeWire nodeから取得（環境変数が必要）

【 通話中のチャットコマンド (部屋内で使用) 】
  /help         コマンド一覧とヘルプを表示する
  /dice [面数]  ダイスを振る（省略時は6面。出目を部屋に送信）
  /waka         古今和歌集から一首を選んで部屋に送信する
  /haiku        正岡子規の俳句から一句を選んで部屋に送信する
  /seiza [星座] 88星座から解説を選んで部屋に送信する
  /uranai [星座] 12星座占いのひとことを部屋に送信する
  /omikuji      運勢と今日の小さな提案を部屋に送信する
  /card         自分の名刺（ひとこと・SNS・お礼窓口）を対話形式で編集する
  /card <番号>  相手の名刺を要求する（SNS外部照会なし）
  /card <番号> --verify  名刺鍵応答後、X・GitHub・Nostrの証拠を照合する
  /tag <話題>   部屋の話題（タグ）を変更する（/notag で消去）
  /list         現在の部屋にいながら、他のアクティブな部屋一覧を見る
  /who          現在の参加者一覧を表示する（行表示モード時）
  /hbk <番号>   相手をこのセッションだけローカルミュートする（/who の番号）
  /unhbk <番号> ローカルミュートを解除する
  /mic          マイクのON/OFFを切り替える (TUIでは 't' キー)
  /mute         スピーカーのON/OFFを切り替える (TUIでは 'm' キー)
  /q, /quit     部屋から退出する (TUIでは 'q' キー)
`;

// `ptk --name 名前` のようにオプションだけなら、コマンドは lobby（--help / -h はそのまま help へ）
const { cmd, rest } = parseCliArgs(process.argv.slice(2));
// BOT指定はprofile・mic-test・接続などの副作用より前に検証する。
const pulseSource = parseBotAudioSource(rest, { command: cmd });
const pipewire = parseBotAudioPipewire(rest, { command: cmd });
if (pipewire && !pulseSource) throw new TypeError('--bot-audio-pipewire requires --bot-audio-source');

const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  const value = i >= 0 ? rest[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : def;
};

// 名乗り。前回覚えたもの（~/.config/ptk/profile.json）に --name / --emoji を重ね、付いていれば覚え直す
const profileFromOpts = async () => {
  const { resolveProfile, profilePath } = await import('./lib/profile.mjs');
  const { loadCardManager } = await import('./lib/card.mjs');
  const r = resolveProfile({ name: opt('name', undefined), emoji: opt('emoji', undefined) });
  const cardManager = await loadCardManager();
  let notice = r.saved ? `📝 名乗りを覚えました：${r.profile.emoji}${r.profile.name}（次からは --name なしでこの名前です）`
    : r.error ? `（名乗りを保存できませんでした：${profilePath()}：${r.error}）` : '';
  if (cardManager.invalidCard) notice += `${notice ? '　' : ''}🛡 保存済み名刺の形式または鍵が一致しないため無効化しました（/cardで設定し直せます）`;
  return { profile: r.profile, notice, cardManager };
};

if (cmd === 'lobby' && rest.includes('--mic-test')) {
  const { runMicTest } = await import('./lib/mic-diagnostic.mjs');
  if (!await runMicTest()) process.exitCode = 1;
} else switch (cmd) {
  case 'lobby':
  case 'ロビー':
    // --konami / --boss はロビー動作確認用の一時フラグ。
    await (await import('./commands/lobby.mjs')).runLobby({ ...await profileFromOpts(), ...parseLobbyOptions(rest) });
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
    const arg = findRoomArgument(rest);
    const { profile, notice, cardManager } = await profileFromOpts();
    if (notice) console.error(notice);
    // 部屋名を付けずに作るときは「名前の部屋」（本家の defaultRoom と同じ）
    const create = creating ? (arg || `${profile.name}の部屋`) : null;
    await (await import('./commands/join.mjs')).runJoin({ ref: creating ? null : arg, create, profile, cardManager, sound: !rest.includes('--no-sound'), eventsJsonl: rest.includes('--events-jsonl'), tts: opt('tts', null), pulseSource, pipewire });
    break;
  }
  default:
    console.error(`不明なコマンド: ${cmd}\n`);
    console.error(HELP);
    process.exit(1);
}
