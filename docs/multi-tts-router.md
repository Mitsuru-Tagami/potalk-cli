# 複数TTSエンジン・話者ルーター（BYOE）

> はじめて使う方は、[VOICEVOX / COEIROINK v2 かんたんセットアップ](tts-quickstart.md)から始めてください。画面でエンジンと声を選ぶだけで、JSONや話者IDの編集は不要です。このページの以下は、既存の手動JSONルーターを使いたい方向けの上級者用資料です。

`ptk` の `--tts` は、受信コメント本文を外部コマンドの標準入力へ渡すだけです。このガイドでは、そのコマンドに **`ptk-tts-router.py`** を指定し、別設定ファイルに書いた話者名・別名・IDからエンジン別の既存ラッパーへ振り分けます。エンジン本体・音声ライブラリ・辞書は同梱しません（BYOE）。

## 構成

```text
potalk-cli
  └─ --tts: docs/ptk-tts-router.py
       ├─ 話者名・別名・生IDを解決（ユーザー設定JSON）
       ├─ VOICEVOX → docs/ptk-voicevox-tts.py → VOICEVOX Engine API
       └─ COEIROINK → docs/ptk-coeiroink-tts.py → COEIROINK v2 API
```

ルーターは各エンジンのHTTP仕様を持たず、設定された argv 配列のコマンドを**シェルを介さず**起動します。話者IDは子プロセスのエンジン固有環境変数に設定し、コメント本文だけを標準入力で渡します。したがって、話者追加・ID変更・エンジンパスの調整はユーザー側のJSONで完結し、`potalk-cli` 本体の変更は不要です。独自エンジンも、同じ標準入力の契約を持つアダプターを書き、設定へ登録すれば利用できます。

## インストール

Python 3と、選択したエンジンの稼働環境が必要です。音声再生には SoX の `play` も必要です。リポジトリのルートからスクリプトとサンプル設定をコピーします。

```bash
mkdir -p "$HOME/bin" "$HOME/.config/ptk"
install -m 755 docs/ptk-tts-router.py "$HOME/bin/ptk-tts-router.py"
install -m 755 docs/ptk-voicevox-tts.py "$HOME/bin/ptk-voicevox-tts.py"
install -m 755 docs/ptk-coeiroink-tts.py "$HOME/bin/ptk-coeiroink-tts.py"
cp docs/tts-router.example.json "$HOME/.config/ptk/tts-router.json"
```

`~/.config/ptk/tts-router.json` を編集し、`engines.*.command` のアダプターパス、API URL、使う話者のIDとスタイルIDを環境に合わせます。JSON内の `/home/you/bin/` は実際のパスに置き換えてください。Windowsでは下位エンジンのコマンドを `"command": ["py", "-3", "C:/Users/you/bin/ptk-voicevox-tts.py"]` のような argv 配列にします。TTS側も `--tts "py -3 C:/Users/you/bin/ptk-tts-router.py --config C:/Users/you/.config/ptk/tts-router.json"` のように、実行コマンドと `--config` を指定してください。

サンプルには、既存COEIROINKガイドと同じ **つくよみちゃん** のUUID/style IDと、VOICEVOXの数値ID例を入れています。VOICEVOXのIDはインストール済み音声ライブラリで異なる場合があるので、まず利用可能なスタイルを確認して設定してください。

```bash
"$HOME/bin/ptk-voicevox-tts.py" --list
"$HOME/bin/ptk-coeiroink-tts.py" --list
"$HOME/bin/ptk-tts-router.py" --config "$HOME/.config/ptk/tts-router.json" --list
```

## 話者名・別名を登録する

`speakers` のキーが表示名、`aliases` が追加の呼び名です。`engine` は `engines` に登録した名前、`id` はエンジン側のUUIDまたは数値IDです。COEIROINKのようにスタイルがある場合は `style_id` も指定します。

```json
"speakers": {
  "つくよみちゃん": {
    "engine": "coeiroink",
    "id": "3c37646f-3881-5374-2a83-149267990abc",
    "style_id": 0,
    "aliases": ["tsukuyomi", "つくよみ"]
  },
  "ゆあちゃん": {
    "engine": "coeiroink",
    "id": "利用環境のspeakerUuidに置き換える",
    "style_id": 0,
    "aliases": ["yua"]
  }
}
```

上記の `ゆあちゃん` は**書式例**です。JSONとして使う前に、IDとstyle IDを実際のエンジン一覧の値へ置き換えてください。平文の別名は Unicode の幅・英字の大小文字を正規化して照合します。異なる話者への別名重複は設定エラーとして扱います。

## 生IDも直接指定できます

- UUID単独: UUID形式を受け取るエンジンが1つだけなら、そのエンジンへ送ります。COEIROINKのstyleは `default_style_id` を使います。
- 数値単独: `default_engine` が数値IDを受け取る設定ならそのエンジンへ送ります。そうでなければ、数値ID用エンジンが1つだけの場合に限り自動解決します。
- エンジン明示: `engine:ID`。COEIROINKなどスタイル指定がある場合は `coeiroink:UUID:styleId` と書けます。

数値IDを複数エンジンが受け付ける構成では曖昧な自動推測をせず、`voicevox:3` のようにエンジン名を付けてください。未登録の平文名も既定話者へ黙って置き換えず、エラーにします。

## `ptk` から使う

話者を省略すると、設定の `default_speaker` を使用します。routerは受信コメントごとに別プロセスとして起動されるため、設定ファイルはコメントごとに読み直されます。実行中に既定話者を切り替える場合は、**`ptk --tts` に `--speaker` を固定で付けず**、設定ファイルの `default_speaker` を変更してください。環境変数 `PTK_TTS_SPEAKER` は `ptk` 起動時の環境で指定する上書き、router自身の `--speaker` はコマンドの選択上書きに使えます。

```bash
ptk join 'https://potalk.app/#room=…&name=…' \
  --tts "$HOME/bin/ptk-tts-router.py"
```

別の場所に設定を置いた場合は `--config` をTTSコマンドに加えます。

```bash
ptk join 'https://potalk.app/#room=…&name=…' \
  --tts "$HOME/bin/ptk-tts-router.py --config $HOME/ptk/tts-router.json"
```

ルーターだけを直接テストするときは、対象の話者を指定できます。

```bash
printf '読み上げテストです。' \
  | "$HOME/bin/ptk-tts-router.py" \
      --config "$HOME/.config/ptk/tts-router.json" \
      --speaker 'つくよみちゃん'

printf 'IDを直接使うテストです。' \
  | "$HOME/bin/ptk-tts-router.py" --speaker 'voicevox:3'
```

`ptk` は受信した**本文だけ**を外部コマンドへ渡す既存契約を保ちます。このため、現状は送信者名やコメントごとのメタデータを使った自動話者選択には対応しません。特定の送信者ごとに声を変える機能が必要になった場合は、本文のみを渡す契約を変えずにメタデータを追加で渡すインターフェースを、別途CLI側で設計する必要があります。

## エンジン設定の要点

- `command`: エンジン用ラッパーを起動する argv 配列。シェル展開・パイプ・リダイレクトは実行しません。Windowsでは `python3` の代わりに `py`, `-3` などを配列要素として指定できます。
- `id_type`: `uuid` / `integer` / `string`。生IDの形式判定に使います。
- `id_env`: `id` を下位アダプターへ渡す環境変数名。
- `style_env`: 任意。指定時は話者の `style_id`（または `default_style_id`）を渡します。
- `env`: API URLなどの追加環境変数。エンジン固有の値をここへ置けます。
- `default_engine`: 数値IDが複数エンジンに存在する際の、生数値IDの既定振り分け先。
- `default_speaker`: `--speaker` / `PTK_TTS_SPEAKER` がない場合の既定話者。

設定ファイルがない・壊れている、別名が未登録、エンジンコマンドが起動できない場合は、その読み上げは失敗します。`ptk` 本体の通話や画面操作は従来どおり継続します。調査時はrouterを直接起動して標準エラーを確認してください。

> エンジン本体、音声ライブラリ、辞書、APIエンドポイントは各ソフトウェアの配布条件・利用規約に従って各自で用意してください。

## 関連資料

- [VOICEVOX Engineセットアップ](voicevox-tts.md)
- [COEIROINK v2セットアップ](coeiroink-tts.md)
- [リファレンスのTTS仕様](reference.md#--tts-の仕様)
