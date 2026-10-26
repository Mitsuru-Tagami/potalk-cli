# リファレンス

potalk-cli（`ptk`）のオプション・環境変数・設定ファイル・外部連携の仕様と、内部のしくみをまとめたリファレンスです。操作の手順は [使い方マニュアル](manual.md)、TURN のセットアップは [TURN ガイド](turn.md) を参照してください。

## CLI コマンドとオプション

### 起動コマンド

| コマンド | 動作 |
| --- | --- |
| `ptk`（`ptk lobby`） | ロビーを TUI で表示する |
| `ptk list` | 通話中の部屋を一覧で出力する（`--seconds N` で待ち時間、既定15秒） |
| `ptk join [招待リンク\|部屋ID\|部屋名の一部]` | 部屋に入る（引数なしならロビーから番号で選択） |
| `ptk create [部屋名]` | 新しい部屋を作って入る（省略時は「あなたの名前の部屋」） |
| `ptk help`（`--help`） | ヘルプを表示する |
| `ptk --mic-test` | 既定マイクを5秒テストする（録音を保存せず、可能ならローカル再生） |

### オプション

| オプション | 対象 | 内容 |
| --- | --- | --- |
| `--name <名前>` | 全般 | 表示名を設定（記憶され、次回以降も使われる。20文字まで） |
| `--emoji <絵文字>` | 全般 | 絵文字を設定（記憶される。8文字まで） |
| `--no-sound` | 全般 | 音声を再生しない |
| `--events-jsonl` | `join`／`create` | 受信コメントと既知参加者の入退室を JSON Lines で標準出力へ出し、画面表示は標準エラーへ |
| `--tts <コマンド>` | 全般 | 受信コメント本文を外部 TTS コマンドへ非同期で渡す |
| `--bot-audio-source <BotSink_X.monitor>` | `join`／`create` | BOT 入力の PulseAudio monitor 契約名（BOT 連携、後述） |
| `--bot-audio-pipewire` | `join`／`create` | BOT 入力を指定 serial の PipeWire node から取得（環境変数が必要。BOT 連携、後述） |
| `--boss`／`--konami` | 全般 | 検証用の一時オプション（削除予定）。ボス画面／隠しスタッフロールを起動直後に表示 |

部屋内コマンドの一覧は [マニュアル](manual.md#部屋内コマンド) を参照してください。

## 環境変数

| 変数 | 内容 |
| --- | --- |
| `POTALK_TURN_WORKER_URL` | 自前 TURN Worker の URL。設定すると TURN 資格情報の取得を試みる（未設定なら TURN 無効）。詳細は [TURN ガイド](turn.md) |
| `POTALK_TURN_TOKEN` | その端末用の Bearer トークン（Worker 側の登録ハッシュと照合される） |
| `POTALK_BOT_PW_REMOTE` | BOT PipeWire 連携：ランナーが用意した専用ソケットの絶対パス |
| `POTALK_BOT_PW_SERIAL` | BOT PipeWire 連携：対象 node の正の10進 `object.serial` |
| `XDG_CONFIG_HOME` | 設定ファイルの置き場所（未設定時は `~/.config`） |

TURN 用の値を毎回打たないため、各端末で env ファイル（例：`~/.potalk-turn.env`、権限600）に export 行を書き、起動前に `source` する運用を想定しています。トークンの値そのものをリポジトリやチャットに貼らないでください。

## 設定ファイル

いずれも `$XDG_CONFIG_HOME/ptk/`（未設定時は `~/.config/ptk/`）配下です。

| ファイル | 内容 |
| --- | --- |
| `profile.json` | 名乗り（表示名・絵文字）。本家と同じ上限（名前20文字・絵文字8文字）で切り詰めて保存 |
| `growth.json` | 木の芽の成長記録（参加回数・利用日数・累積滞在時間）。ブラウザ版の記録とは別 |
| `card.json` | 名刺データ（ひとこと・SNS ID・お礼窓口など） |
| `card-key.json` | 名刺の鍵（権限0600）。ブラウザ版の「取り出せない鍵」と同じ保護特性ではない点に注意 |

## --events-jsonl の仕様

`ptk join` または `ptk create` に `--events-jsonl` を付けると、受信チャットと既知参加者の入退室を標準出力へ JSON Lines で出力します。このモードでは通常の画面表示・操作プロンプトは標準エラーへ出るため、標準出力を外部スクリプトへパイプできます。

- チャット行：`{"type":"chat","from":"💻表示名","text":"コメント本文"}`（**従来どおり変更しません**）
- 入室行：`{"type":"presence","action":"join","name":"🦊表示名"}`
- 退出行：`{"type":"presence","action":"leave","name":"🦊表示名","clean":true}`（`clean:false` は予期しない切断）

対象は、プロフィールを受け取って表示対象になった参加者のみです（名乗る前に切断した相手は含みません）。システム通知や自分が送った発言は含みません。自分が送信した遊びコマンドの結果（`/dice` の出目など）も含みません。consumer は `type` を見て `chat` と `presence` を分けて処理してください。ストリーム全体はチャットだけではなくなっています。入退室の表示名をログへ保存する場合は、利用者情報の扱いに注意してください。

`/tag` は話題メタデータの変更機能で、入退室イベントの機械判読シグナルではありません。

## --tts の仕様

`--tts <コマンド>` を付けると、受信したチャットの **本文だけ** を外部コマンドの標準入力へ渡して読み上げます（例：Linux では `--tts 'espeak-ng -v ja'`、macOS では `--tts 'say -v Kyoko'`）。`ptk join` / `ptk create` のほか、ロビー TUI を起動する `ptk --tts 'say -v Kyoko'` でも使えます。TTS エンジンや辞書は含まれず、未指定時は読み上げません。

- TTS コマンドはシェルを介さず起動し、空白区切りと引用符で実行ファイル・引数を指定します（パイプやリダイレクト等のシェル構文は使えません）
- 子プロセスは非同期で、標準出力・標準エラーは破棄します。読み上げを順番に処理するため、受信・入力・画面表示や `--events-jsonl` の JSONL 出力は待たされません
- コマンドが見つからない、または途中で失敗した場合は、その読み上げだけを諦めて CLI は継続します

VOICEVOX / COEIROINK v2 の利用は [かんたんセットアップ](tts-quickstart.md) から始めてください。手動設定は [VOICEVOXガイド](voicevox-tts.md)・[COEIROINK v2ガイド](coeiroink-tts.md)、複雑な JSON ルーター設定は [上級者向けガイド](multi-tts-router.md) にあります。

## しくみ

### WebRTC と音声の経路

- WebRTC は [@roamhq/wrtc](https://github.com/WonderInventions/node-webrtc)（Chromium と同じ libwebrtc）を使っています。po-talk は部屋の全員から音が届く前提なので、CLI はマイクの代わりに **無音の音声トラック** を送ります（ブラウザからは「ミュート中の人」に見えます）。配信部屋では聞き役として入るので、音は送りません。
- 相手の声は、wrtc がデコードした音（PCM）を相手ごとに混ぜて、SoX の `play` に流して鳴らしています。
- 自分の声は、SoX の `rec` でマイクの音を取り、無音のかわりに送っています。マイクは入るときオフで、オンにしている間だけ `rec` が動きます。エコーキャンセルが無いためヘッドホンが必要です（[マニュアル](manual.md#マイクの注意)）。
- 接続形態（TURN のある／ない場合）は [TURN ガイド](turn.md) を参照してください。TUI の接続状態表示（`[ICE]`）は、TURN 資格情報が有効な間は relay 接続であることを示します。

### 配信部屋の名簿と本人確認（oath）

配信部屋の声は、po-talk と同じく「配信者が許可した人」の分だけを鳴らします。許可は、配信者が自分の秘密鍵で署名した名簿で配られ、CLI は公開鍵が部屋 ID の指紋と合うこと・署名・時刻（古い名簿の使い回し）を確かめてから従います（`lib/roster.mjs`）。名簿に載っていない人の声は、改造クライアントから送られてきても鳴らしません。

配信者の `peerId` も本人確認されるまで信頼せず、`oath` のチャレンジ応答を採用済み名簿の公開鍵で検証してから、その人の音声を再生します（`lib/oath.mjs`）。CLI は聞き役としての対応で、配信者側の鍵・署名機能は持ちません。

### 名刺（card）と本人確認

名刺は本家本番と同じ `card` action で、要求された相手1人だけに送ります。応答は `{k:'res', bio?, avatar?, socials?, tip?, ck?, pr?}` で、`pr` は X/GitHub/Nostr の本人確認証拠であり、本文署名ではありません。通常の取得では外部照会せず、一括した「本人確認済み」とも表示しません。

`/card <番号> --verify` の明示時だけ、鍵応答成功後に本家の証拠を照合します。`ck` があれば `card\n部屋ID\n要求側peerId\n応答側peerId\nnonce` に対する P-256/SHA-256・IEEE P1363 署名を確かめますが、これは接続相手のカード鍵所持応答だけを示し、カード本文・人・SNS アカウントの真正性は証明しません。確認に失敗したカードも未検証として表示します。

成功表示は SNS アカウントと名刺鍵の結び付きを示すもので、アカウント所有者の実名・人間としての身元・名刺のひとこと等の真偽は確認しません。

| SNS | 照合内容 | 確認できること／できないこと |
| --- | --- | --- |
| X | `pr.x` の投稿を oEmbed で取得し、応答の `author_url` が `socials.x` と一致することと投稿本文に鍵指紋行があることを確認 | その X アカウントが名刺鍵指紋を含む投稿を公開したこと。実名や他の記載内容は確認しません |
| GitHub | `pr.github: 1` がある場合、プロフィール API の `login` が `socials.github` と一致し、bio に鍵指紋行があることを確認 | その GitHub プロフィールの bio が名刺鍵指紋を掲示していること。実名や他の記載内容は確認しません |
| Nostr | `socials.nostr` の npub とイベント pubkey の一致、kind 30078・`d=potalk-card`・鍵指紋行、および NIP-01 ID/署名を検証 | 対応する Nostr 秘密鍵が名刺鍵指紋を含む証拠イベントに署名したこと。実名や他の記載内容は確認しません |
| note・Instagram・YouTube | 本家プロトコルに照合可能な証明方式がありません | ID は自己申告のままです（YouTube の照合も本家で未定義）。確認済みにはしません |

名刺本文は署名されません。ひとこと・アイコン・SNS ID・お礼窓口は受け取った側で真偽を確認できず、お礼窓口は本人申告のままです。SNS 照合失敗・タイムアウト・proof 欠落は確認済みにしません。

## BOT 連携契約

お姉ちゃん BOT などの専用ランナーと連携するための契約です。人格・台詞・WAV・BOT の運用ランナー自体はこのリポジトリの範囲外です。

### PulseAudio 経路（契約名 `potalk-bot-audio-v1`）

`ptk join` / `ptk create` は、専用ランナーが生成した `BotSink_<英数字>.monitor` を `--bot-audio-source` で受け取る構成に対応します。許可される値はこの形式だけで、パス・任意の PulseAudio ソース名・既定入力へのフォールバックは受け付けません。BOT 参加時は専用入力を使って発話状態を明示的にオンにします。`/mic` の手動切替を使う場合も同じ専用入力を維持します。

配信部屋の聞き役は送音できないため、BOT 音声ソースを指定しても安全に拒否されます。専用ランナーの稼働や部屋接続を行わず、対応契約だけを確認するには次を実行できます。

```bash
node lib/bot-audio.mjs --check
# potalk-bot-audio-v1
```

### PipeWire 経路（契約名 `potalk-bot-audio-pipewire-v1`）

`--bot-audio-pipewire` を併用する場合は、ランナーが用意した専用ソケットの絶対パスを `POTALK_BOT_PW_REMOTE`、対象 node の正の10進 `object.serial` を `POTALK_BOT_PW_SERIAL` で指定します。入力は `pw-cat` でその serial へ固定し、停止・障害時に既定マイクへフォールバックしません。`node ptk.mjs --check-pipewire` は接続せず `potalk-bot-audio-pipewire-v1` を返す契約確認専用経路です。

### オフライン回帰確認

契約まわりのオフライン回帰テストは次のコマンドで実行できます。音声・部屋処理はモックへ差し替え、PCM はメモリ内の合成値だけを使います（`--mic-test` を呼ぶ CLI テストファイルは含めません。`test/pipewire-mic-driver.mjs` は実録音用の手動検証補助で、この検査には含めません）。

```bash
node --test \
  test/bot-audio.test.mjs test/bot-audio-integration.test.mjs \
  test/pipewire-bot-audio.test.mjs test/mic-input.test.mjs \
  test/presence-events.test.mjs test/events.test.mjs \
  test/local-mute.test.mjs test/room.test.mjs
```

ここでの合格は実デバイス・実部屋・実音声到達・長時間運転の確認ではありません。
