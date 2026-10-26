# Linux Mint + XFCEでVOICEVOX Engineを使う

> まず手軽に読み上げを始めたい場合は、[VOICEVOX / COEIROINK v2 かんたんセットアップ](tts-quickstart.md)をご利用ください。エンジンと声を選ぶだけで設定でき、IDやJSONを手で編集する必要はありません。このページはエンジンの導入・APIの詳しい手動設定用です。

`ptk` が受信したチャットコメントを、ローカルで動かす VOICEVOX Engine に読み上げさせるための手順です。特に、`espeak-ng` では読みづらい漢字かな交じりの日本語コメントを読み上げたい場合に使えます。

この手順は **BYOE（Bring Your Own Engine）** 方式です。VOICEVOX Engineや音声ライブラリは `potalk-cli` に含まれず、インストールや起動も別途必要です。`ptk` は受信コメント本文を外部コマンドの標準入力へ渡すだけです。

## 1. 用意するもの

- 動作する `potalk-cli`（Node.js 20.6以上）
- VOICEVOX または VOICEVOX Engine。Engineを起動し、APIサーバーを利用可能にしておきます
- Python 3
- SoXの `play` コマンド（Linux Mintでは `sox` パッケージ）
- Engineと `ptk` を動かす同じLinuxユーザーのオーディオ出力

`curl` と SoX がまだなければ、ターミナルでインストールします。

```bash
sudo apt update
sudo apt install curl sox
```

VOICEVOX Engineの通常のローカルAPIアドレスは `http://127.0.0.1:50021` です。Engineを起動したあと、APIドキュメントまたは `/speakers` に接続できることを確認してください。

```bash
curl -fsS http://127.0.0.1:50021/speakers >/dev/null \
  && echo 'VOICEVOX Engineに接続できました'
```

`curl` が接続エラーになる場合は、まずEngineが起動しているか確認してください。ポートやホストを変更している場合は、以降の `VOICEVOX_URL` も合わせます。

## 2. 話者とスタイルIDを調べる

Engineの `GET /speakers` は、利用できる話者とスタイルを返します。次のコマンドで話者名・スタイル名・**style ID**を一覧表示できます。

```bash
python3 - <<'PY'
import json
import urllib.request

url = 'http://127.0.0.1:50021/speakers'
with urllib.request.urlopen(url, timeout=10) as response:
    speakers = json.load(response)
for speaker in speakers:
    for style in speaker.get('styles', []):
        print(f"{style['id']:>5}  {speaker['name']} / {style['name']}")
PY
```

使いたいスタイルの先頭に表示された数値を控えます。話者名ではなく、この数値（style ID）を後の `VOICEVOX_SPEAKER` に指定します。利用できる話者やIDは、Engineや音声ライブラリの構成によって異なります。

## 3. 読み上げラッパーを作る

`ptk --tts` は、指定された外部コマンドを起動し、受信コメント本文をその標準入力に渡します。以下のPythonスクリプトは、標準入力のテキストをVOICEVOX Engineの `/audio_query` と `/synthesis` に送り、返ってきたWAVをSoXで再生します。Python標準ライブラリだけを使うため、`pip` で追加パッケージを入れる必要はありません。

```bash
mkdir -p "$HOME/bin"
cat > "$HOME/bin/ptk-voicevox.py" <<'PY'
#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get('VOICEVOX_URL', 'http://127.0.0.1:50021').rstrip('/')


def post(path, params, body, content_type=None):
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    headers = {}
    if content_type:
        headers['Content-Type'] = content_type
    request = urllib.request.Request(url, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main():
    text = sys.stdin.read().strip()
    if not text:
        return

    try:
        speaker = int(os.environ.get('VOICEVOX_SPEAKER', '3'))
        query_bytes = post(
            '/audio_query',
            {'text': text, 'speaker': speaker},
            b'',
        )
        query = json.loads(query_bytes.decode('utf-8'))
        wav = post(
            '/synthesis',
            {'speaker': speaker},
            json.dumps(query, ensure_ascii=False).encode('utf-8'),
            'application/json',
        )
        subprocess.run(['play', '-q', '-t', 'wav', '-'], input=wav, check=True)
    except (ValueError, OSError, urllib.error.URLError, urllib.error.HTTPError,
            json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print(f'ptk-voicevox: {error}', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
PY
chmod +x "$HOME/bin/ptk-voicevox.py"
```

上の `VOICEVOX_SPEAKER` の既定値 `3` は例です。**手順2で確認した、実際に使いたいstyle IDに置き換えてください。** 例えばIDが `8` なら、次のように環境変数を設定します。

```bash
export VOICEVOX_SPEAKER=8
# EngineのURLを変えている場合だけ設定（例）
# export VOICEVOX_URL=http://127.0.0.1:50021
```

スクリプトは `VOICEVOX_URL` と `VOICEVOX_SPEAKER` を環境変数から読みます。標準設定のままならURLの設定は不要です。

## 4. 先に単独でテストする

`ptk` から使う前に、短いテキストを直接ラッパーへ渡して音が出ることを確認します。

```bash
printf '漢字かな交じりの読み上げテストです。' \
  | "$HOME/bin/ptk-voicevox.py"
```

ここで再生できない場合は、Engineが動作中であること、`VOICEVOX_SPEAKER` が `/speakers` に載っているstyle IDであること、SoXの `play` が利用可能であることを確認します。直接テストではエラーがターミナルに出ます。

## 5. `ptk` で受信コメントを読み上げる

招待リンクから参加する例です。

```bash
ptk join 'https://potalk.app/#room=…&name=…' \
  --tts "$HOME/bin/ptk-voicevox.py"
```

部屋を作る場合は次のようにします。

```bash
ptk create '読み上げテスト' --tts "$HOME/bin/ptk-voicevox.py"
```

ロビーTUIを起動して、そこから部屋を選ぶ場合にも指定できます。

```bash
ptk --tts "$HOME/bin/ptk-voicevox.py"
```

`VOICEVOX_SPEAKER` と `VOICEVOX_URL` は `ptk` にも引き継がれます。必要な環境変数を設定した同じターミナルから `ptk` を起動してください。

## 動作上の注意

- 読み上げの対象は **相手から受信したコメント本文だけ** です。自分のコメントやシステム通知は読み上げません。
- VOICEVOX Engineや話者ライブラリは本プロジェクトに同梱されません。各ソフトウェア・音声ライブラリの配布条件や利用規約に従ってください。
- `ptk` はTTSコマンドをシェル経由ではなく起動します。パイプやリダイレクトなどのシェル構文は `--tts` の値に書けません。ここでは実行ファイルとしてラッパーのパスを指定します。
- 読み上げコマンドは非同期で順番に処理されます。コマンドが見つからない、Engineへの接続や合成に失敗するなどの場合、その読み上げだけが失敗し、`ptk` の通話・画面操作は継続します。`ptk` は外部コマンドの標準エラーを表示しないため、エラーを調べるときは手順4のようにラッパーを直接実行してください。
- CLIにはブラウザのようなエコーキャンセルがありません。スピーカーから出た読み上げ音声がマイクに入り、通話相手へ回り込むことがあります。**ヘッドホンを使い、必要がなければマイクをオフにしてください。**

## 参考

- [VOICEVOX Engine APIドキュメント](https://voicevox.github.io/voicevox_engine/api/)（`GET /speakers`、`POST /audio_query`、`POST /synthesis`）
- [`potalk-cli` リファレンスのTTS仕様](reference.md#--tts-の仕様)
