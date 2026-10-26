# potalk-cli

[ぽっと通話 (po-talk.github.io)](https://github.com/po-talk/po-talk.github.io) の派生CLI版です。

## これはなに？

ブラウザベースで動く「ぽっと通話」のコア機能と外見を分離してみたらどうなるか？というテストの一環として作成した、ターミナル向けのクライアント（CLI版）です。

本家と同じロビー・同じ Nostr リレーに乗り入れているので、ブラウザ版で通話中の部屋がそのまま見え、同じ部屋に入れます。通常の部屋では「参加者を見る・**声を聞く**・**話す**・**ひとことを読む／書く**・話題タグを見る」ができ、配信部屋では聞き役として入ります（配信者と、配信者が許可した人の声が聞こえます。話すことはできません）。

vimjpやNostrのどこかに生息しているであろう、黒い画面を愛する**Vimmerに向けた熱いラブコール**でもあります（笑）。

## なぜ Node.js なのか？

GoやRustといった渋い言語も検討しましたが、動いている元のHTML/JavaScriptからコードやモジュールを「うまく拝借（移植）」しながらスピーディーに形にするため、今回は **Node.js** を選択しました。

## インストール

Node.js **20.6以上**が必要です。ネイティブWebRTC依存の対応範囲に合わせ、Node.js 22を推奨します。音声を聞く・話すには SoX の `play`・`rec` コマンドも必要です。

Windows・macOS・Linuxの詳しい手順（Node.js、SoX、インストール、起動確認）は[OS別の導入ガイド](docs/install.md)を参照してください。

```bash
git clone https://github.com/Mitsuru-Tagami/potalk-cli.git
cd potalk-cli
npm ci
npm link          # ptk コマンドとして使えるようにする（任意）
ptk help
```

`npm link` を使わない場合は、リポジトリ内で `node ptk.mjs help` のように実行できます。

## クイックスタート

```bash
ptk               # ロビーを TUI で表示（j/k で移動、Enter で部屋に入る、/ で絞り込み、r で再読み込み、q で終了）
ptk list          # 通話中の部屋を一覧で出力（--seconds N で待ち時間、既定 15 秒）
ptk join          # ロビーから番号で選んで部屋に入る
ptk join 'https://potalk.app/#room=…&name=…'   # 招待リンクで入る
ptk join アサ      # 名前の一部で入る（部屋名・話題タグ・いる人の名前。複数合えば番号で選ぶ）
ptk create 部屋名  # 新しい部屋を作って入る（部屋名を省くと「あなたの名前の部屋」）
ptk --mic-test     # 既定マイクを5秒テスト（録音を保存せず、可能ならローカル再生）
ptk help
```

`--name 名前`・`--emoji 絵文字` で名乗れます（`ptk`・`join`・`create` のどれでも）。**一度付ければ覚えて、次からは付けなくてもその名前**になります。名乗らなければ、最初に「深煎りキリマンジャロ」のようなコーヒーの名前を自動で付けます。音を鳴らしたくないときは `--no-sound` を付けます。

操作や部屋内コマンドの詳しい使い方は [使い方マニュアル](docs/manual.md) を参照してください。

> [!WARNING]
> **CLI を使うと、原則としてあなたの IP アドレスが相手から見えます。**
> po-talk のブラウザ版は TURN 中継を通すので相手に IP が見えませんが、CLI は既定では TURN を使わず、相手と直接つなぎます（STUN のみ）。同じ部屋の人だけでなく、ロビーを開いているブラウザからも見えます。
> 自前の TURN Worker を設定した場合のみ、中継（relay）接続で IP を見せない使い方ができます。仕組み・設定方法・「設定しない場合」との違いは [TURN ガイド](docs/turn.md) を参照してください。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [使い方マニュアル](docs/manual.md) | ロビーと部屋の操作、部屋内コマンド、名刺、遊びコマンド、ボス画面など「使い方」のすべて |
| [リファレンス](docs/reference.md) | CLI オプション・環境変数・設定ファイル、`--events-jsonl`／`--tts` の仕様、しくみ（音声・名簿・名刺検証）、BOT 連携契約 |
| [TURN ガイド](docs/turn.md) | TURN のある場合／ない場合の違い、自前 Worker のセットアップと運用 |
| [OS別の導入ガイド](docs/install.md) | Windows・macOS・Linux の導入手順とトラブルシューティング |
| [かんたんTTSセットアップ](docs/tts-quickstart.md) | VOICEVOX / COEIROINK v2 で受信コメントを読み上げる |
| [本家との差異メモ](potalk-cli-vs-po-talk.md) | 本家 po-talk.github.io との機能・プロトコルの差 |
| [更新履歴](docs/changelog.md) | 変更履歴（新しい順） |

TTS の詳細設定は [VOICEVOXガイド](docs/voicevox-tts.md)・[COEIROINK v2ガイド](docs/coeiroink-tts.md)・[上級者向けルーターガイド](docs/multi-tts-router.md) を、データの出典は [句データの出典](docs/poem-data-sources.md)・[88星座データの出典](docs/constellation-data.md) を、隠し要素については [イースターエッグのメモ](docs/easter-egg.md) を参照してください。

## 開発

```bash
npm test          # 自動テスト（ネットワークは使いません）
```

PR を出すと、GitHub Actions で Mac と Linux、Node 20・22・24 のテストが走ります。
`trystero`・`@roamhq/wrtc`・`blessed` は、内部の作りに頼った回避策があるので版を固定しています（`lib/polyfill.mjs`・`lib/tui.mjs`）。上げるときは `npm test` で確かめてください。

アーキテクチャの概要は [SPEC.md](SPEC.md) を参照してください。

## 作者

田上光 (Mitsuru Tagami)

## ライセンス

元リポジトリに準拠し、本プロジェクトも MITライセンス となります。
詳細は LICENSE ファイルをご確認ください。
