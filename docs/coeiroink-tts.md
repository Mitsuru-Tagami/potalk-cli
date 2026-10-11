# Linux Mint + XFCEでCOEIROINK v2を使う

`ptk` が受信したチャットコメントを、ローカルで動かす COEIROINK v2 に読み上げさせる手順です。Python製の読み上げラッパーもこのリポジトリに含めています。

この手順は **BYOE（Bring Your Own Engine）** 方式です。COEIROINK本体や音声ライブラリは `potalk-cli` に含まれません。COEIROINKのダウンロード・インストール・起動は別途行ってください。`ptk` は受信コメント本文を外部コマンドの標準入力へ渡します。

## 1. 用意するもの

- 動作する `potalk-cli`（Node.js 20.6以上）
- Linux版 COEIROINK v2 と、利用する話者・音声ライブラリ
- Python 3
- SoX の `play` コマンド（Linux Mintでは `sox` パッケージ）
- COEIROINKと`ptk`を動かす同じLinuxユーザーのオーディオ出力

必要なコマンドがまだなければ、ターミナルでインストールします。

```bash
sudo apt update
sudo apt install python3 sox unzip curl
```

## 2. COEIROINK v2を起動する

[COEIROINK公式サイト](https://coeiroink.com/)からLinux版を入手し、ZIPを任意の場所へ展開します。展開したフォルダーにある `COEIROINKv2` を実行してください。公式案内では、Linux版はZIPを展開して `COEIROINKv2` を実行する手順です。

ターミナルから起動する場合は、展開先に移動して次のようにします（フォルダー名は実際のものに置き換えてください）。

```bash
cd "$HOME/Downloads/COEIROINK_LINUX_XXX_v.x.x.x"
chmod +x ./COEIROINKv2
./COEIROINKv2
```

COEIROINKの画面を開いたままにします。APIの標準アドレスは `http://127.0.0.1:50032` です。まず公式のAPIドキュメントが開けることを確認します。

```bash
curl -fsS http://127.0.0.1:50032/docs >/dev/null \
  && echo 'COEIROINK APIに接続できました'
```

接続エラーになる場合は、COEIROINKが起動しているか確認してください。APIのポートやホストを変更している場合は、後述の `COEIROINK_API` も合わせます。

## 3. ラッパーをインストールして話者を選ぶ

リポジトリのルートディレクトリから、同梱スクリプトをユーザー用の `bin` ディレクトリへコピーします。

```bash
mkdir -p "$HOME/bin"
install -m 755 docs/ptk-coeiroink-tts.py "$HOME/bin/ptk-coeiroink-tts.py"
```

`--list` を付けると、COEIROINKから利用可能な話者・スタイルとそのIDを一覧表示します。

```bash
"$HOME/bin/ptk-coeiroink-tts.py" --list
```

表示された話者の `uuid` と、使いたいスタイルの `styleId` を控え、環境変数に設定します。

```bash
export COEIROINK_UUID='話者一覧のuuid'
export COEIROINK_STYLE_ID='話者一覧のstyleId'
```

ラッパーの既定値は、公式API例にある**つくよみちゃん・れいせい**のUUID `3c37646f-3881-5374-2a83-149267990abc` と `styleId=0` です。環境にその話者・スタイルがない場合は、一覧で確認した値を指定してください。APIアドレスを変更している場合だけ、たとえば次のように設定します。

```bash
export COEIROINK_API='http://127.0.0.1:50032'
```

これらの環境変数を設定した同じターミナルから、以降のテストや `ptk` を起動します。

## 4. `ptk` から使う前にテストする

ラッパーは標準入力から本文を読み、COEIROINK APIでWAVを生成し、SoXの `play` で再生します。Python標準ライブラリだけを使うため、追加のPythonパッケージは不要です。

```bash
printf '漢字かな交じりの読み上げテストです。' \
  | "$HOME/bin/ptk-coeiroink-tts.py"
```

ここで再生できない場合は、COEIROINKが起動中か、`--list` に指定したUUIDとスタイルIDが存在するか、SoXの `play` が利用できるかを確認します。直接実行するとエラーがターミナルに表示されます。

## 5. `ptk` で受信コメントを読み上げる

招待リンクから参加する例です。

```bash
ptk join 'https://potalk.app/#room=…&name=…' \
  --tts "$HOME/bin/ptk-coeiroink-tts.py"
```

部屋を作る場合は次のようにします。

```bash
ptk create '読み上げテスト' --tts "$HOME/bin/ptk-coeiroink-tts.py"
```

ロビーTUIを起動し、そこから部屋を選ぶ場合にも指定できます。

```bash
ptk --tts "$HOME/bin/ptk-coeiroink-tts.py"
```

## APIとVOICEVOX Engineの違い

このラッパーはCOEIROINK v2のAPIを使います。

- 話者一覧: `GET /v1/speakers`
- 音声合成: `POST /v1/synthesis`（合成結果はWAV）
- 標準APIアドレス: `http://127.0.0.1:50032`

VOICEVOX Engineの例で使う `POST /audio_query` → `POST /synthesis` という2段階の手順とは異なり、COEIROINK v2では本文・話者UUID・スタイルIDなどを指定して `/v1/synthesis` に直接POSTします。スクリプトの `--list` は `/v1/speakers` を呼び出します。

## 動作上の注意

- 読み上げるのは**相手から受信したコメント本文だけ**です。自分のコメントやシステム通知は読み上げません。
- COEIROINK本体や音声ライブラリは本プロジェクトに同梱されません。各ソフトウェア・音声ライブラリの配布条件や利用規約に従ってください。
- `ptk` はTTSコマンドをシェル経由ではなく起動します。パイプやリダイレクトなどのシェル構文は `--tts` の値に書けません。ここでは実行ファイルとしてラッパーのパスを指定します。
- 読み上げコマンドは非同期で順番に処理されます。コマンドが見つからない、APIへの接続や合成に失敗するなどの場合、その読み上げだけが失敗し、`ptk` の通話・画面操作は継続します。`ptk` は外部コマンドの標準エラーを表示しないため、エラーを調べるときは手順4のようにラッパーを直接実行してください。
- CLIにはブラウザーのようなエコーキャンセルがありません。スピーカーから出た読み上げ音声がマイクに入り、通話相手へ回り込むことがあります。**ヘッドホンを使い、必要がなければマイクをオフにしてください。**

## 参考

- [COEIROINK公式: Linux版の解凍と起動方法](https://coeiroink.com/help/001)
- [COEIROINK公式: API仕様の確認方法](https://coeiroink.com/help/002)
- [COEIROINK公式: APIリクエスト例](https://coeiroink.com/help/031)
- [`potalk-cli` READMEのTTSオプション](../README.md#使い方)
