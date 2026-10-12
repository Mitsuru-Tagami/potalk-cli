# VOICEVOX / COEIROINK v2 かんたんセットアップ

Linux Mint + XFCEで、インストール済みの **VOICEVOX** または **COEIROINK v2** を `ptk` の読み上げに使う手順です。初回に一度声を選べば、**設定ファイルや話者IDを手で調べたり編集したりする必要はありません。**

## 1. エンジンを起動する

使いたいエンジンのアプリを起動し、そのまま開いておきます。エンジン本体と音声ライブラリは別途インストールが必要です（`potalk-cli` には同梱しません）。

> 2つとも起動しておくと、セットアップ画面でどちらの声を使うか選べます。片方だけ起動している場合も、そのエンジンだけで設定できます。

## 2. 読み上げコマンドを一度だけ設置する

ターミナルで `potalk-cli` のフォルダーへ移動し、次をそのまま実行します。

```bash
mkdir -p "$HOME/.local/bin"
install -m 755 docs/ptk-tts.py "$HOME/.local/bin/ptk-tts"
```

## 3. 画面の案内でエンジンと声を選ぶ

```bash
"$HOME/.local/bin/ptk-tts" --setup
```

スクリプトがVOICEVOXとCOEIROINK v2のAPIへ接続し、利用可能な声を調べます。画面の番号を入力して、使うエンジンと声を選んでください。選んだ設定は自動で保存されます。

- 保存先: `~/.config/ptk/tts.json`（`XDG_CONFIG_HOME`を指定している場合はその配下）
- 話者名やIDをメモしたり、JSONを開いて書き換えたりする必要はありません。
- 別のエンジンや声に変えるときは、同じ `--setup` をもう一度実行します。

「未接続」と表示されたエンジンは、アプリを起動してから再度セットアップしてください。標準APIアドレスはVOICEVOXが `http://127.0.0.1:50021`、COEIROINK v2が `http://127.0.0.1:50032` です。少なくとも使いたい方のエンジンが起動していれば選べます。

## 4. 音声を試す

```bash
"$HOME/.local/bin/ptk-tts" --test
```

音が出ない場合、Linux MintではSoXをインストールします。

```bash
sudo apt update
sudo apt install sox
```

利用可能な声とAPI接続をもう一度確認する場合は、次を実行します。

```bash
"$HOME/.local/bin/ptk-tts" --list
```

## 5. `ptk` の読み上げに使う

ロビーから部屋を選ぶ場合:

```bash
ptk --tts "$HOME/.local/bin/ptk-tts"
```

招待リンクから直接入る場合:

```bash
ptk join 'https://potalk.app/#room=…&name=…' \
  --tts "$HOME/.local/bin/ptk-tts"
```

`ptk` が受信したコメント本文だけを、選んだ声で読み上げます。自分の発言やシステム通知は対象外です。スピーカー音がマイクへ回り込まないよう、通話中はヘッドホンの使用をおすすめします。

## 接続に失敗するとき

1. 選んだVOICEVOXまたはCOEIROINK v2が起動したままか確認します。
2. `"$HOME/.local/bin/ptk-tts" --list` を実行し、声の一覧が取れるか確認します。
3. 起動した声やエンジンを変更したときは、`--setup` を再実行します。
4. `--test` は直接エラーを表示します。エンジンの接続先を標準以外に変更している場合は、セットアップ時に環境変数 `VOICEVOX_URL` または `COEIROINK_API` にそのAPIのURLを指定してください。

このラッパーはPython標準ライブラリのみを使います。音声の生成は利用者が起動したローカルエンジンに依頼します。エンジン本体・音声ライブラリ・辞書は含まれず、それぞれの利用条件に従ってください。

## 関連ガイド

- [VOICEVOX Engineのインストール・手動設定ガイド](voicevox-tts.md)
- [COEIROINK v2のインストール・手動設定ガイド](coeiroink-tts.md)
- [従来のJSONルーター設定（上級者向け）](multi-tts-router.md)
