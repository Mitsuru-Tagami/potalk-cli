# TURN ガイド

potalk-cli の TURN（中継）接続について、仕組みとセットアップをまとめたガイドです。

## TURN のある場合／ない場合

|  | TURN なし（既定） | TURN あり（自前 Worker を設定した場合） |
| --- | --- | --- |
| 接続経路 | 相手と直接接続（STUN のみ） | Cloudflare の TURN サーバー経由（relay のみ） |
| IP の見え方 | **同じ部屋の相手と、ロビーを開いているブラウザから、あなたの IP が見える** | 部屋の相手にあなたの IP は見えない |
| 必要なもの | なし | 自分の Cloudflare アカウント、TURN キー、自前 Worker、端末別トークン |
| 資格情報が取れないとき | ― | STUN 直結にフォールバックし、その旨を画面に表示する（IP が見える状態であることを隠さない） |

po-talk のブラウザ版は本家の運用する Worker から TURN 資格情報を取得して中継接続しています。CLI はその Worker を共用できないため（本家との取り決め）、**自分の Cloudflare アカウントで Worker と TURN キーを運用する**形にしています。本家の Worker のコード（MIT ライセンス）は表示条件を守って流用しています。

TURN は「合鍵を渡すだけ」の仕組みです。Worker は資格情報の発行機であって通信の経路ではなく、音声・シグナリング・在室情報は Worker を通りませんし、保存もしません。

### TURN を設定しても変わらないこと

- ロビーへの在室告知や部屋の情報は、従来どおり Nostr リレー経由です（TURN の対象は部屋内の WebRTC 接続です）
- `/card <番号> --verify` の SNS 照合（X・GitHub への照会）は通常の HTTPS 通信で、照会先に接続元 IP が伝わる場合があります
- 接続済みの相手との経路は資格情報の更新では切り替わりません（新しい接続から relay になります）。これは本家と同じ制約です

## 仕組み（CLI 側）

- 環境変数 `POTALK_TURN_WORKER_URL` と `POTALK_TURN_TOKEN` が設定されている場合だけ、起動時と接続時に Worker から TURN 資格情報を取得します（`lib/turn.mjs`）。未設定なら TURN は無効で、従来どおり STUN のみです
- 認証は端末別 Bearer トークンです。Worker は提示されたトークンを SHA-256 化し、登録済みハッシュと定数時間比較します。認証に失敗したリクエストは、上流（Cloudflare の資格情報発行 API）を叩く前に 403 で返します
- 資格情報の ttl は4時間（14400秒）です。CLI は取得結果を10分キャッシュし、5分間隔で再取得して接続設定を差し替えます。資格情報が失効したのに更新できない場合は、relay を落として STUN に切り替え、警告を表示します
- 取得に成功している間は `iceTransportPolicy: 'relay'`（中継のみ）で接続します。TUI の接続状態表示（`[ICE]`）に relay であることが出ます

## セットアップ

### 1. Cloudflare で TURN キーを発行する

Cloudflare ダッシュボードの Realtime（旧 Calls）→ TURN Keys でキーを発行します。Key ID と API Token が得られます。**API Token は発行時に一度だけ表示される**ので、その場で控えてください（Key ID は後から再表示できます）。

### 2. Worker をデプロイする

このリポジトリの [`worker/pot-turn-cli.js`](../worker/pot-turn-cli.js) を Cloudflare Workers に配置します（wrangler を使う場合は `worker/` ディレクトリが作業場所です）。Worker の URL（例：`https://potalk-cli-turn.<あなたのサブドメイン>.workers.dev`）が発行されます。

### 3. Worker に Secret を設定する

| Secret | 値 |
| --- | --- |
| `TURN_KEY_ID` | 手順1の Key ID |
| `TURN_KEY_API_TOKEN` | 手順1の API Token |
| `CLI_TURN_TOKENS` | `{"端末名": "sha256(端末用トークン) の hex（小文字）", ...}` の JSON |

長期キー（API Token）は Worker の Secret にのみ置き、リポジトリや端末には置きません。Secret の意味と扱いの正本は `worker/pot-turn-cli.js` 冒頭の説明です。

### 4. 端末ごとにトークンを発行する

端末の数だけ、ランダムなトークンを作り、そのハッシュを `CLI_TURN_TOKENS` に登録します。トークンそのものはその端末にだけ置きます。

```bash
TOKEN=$(openssl rand -hex 24)
printf '%s' "$TOKEN" | sha256sum   # ← このハッシュを CLI_TURN_TOKENS に {"端末名": "…"} として登録
echo "$TOKEN"                      # ← トークン本体はその端末の env にだけ書く
```

### 5. 端末で環境変数を設定する

```bash
export POTALK_TURN_WORKER_URL='https://<あなたの Worker の URL>'
export POTALK_TURN_TOKEN='<その端末用のトークン>'
```

毎回打たないため、env ファイル（例：`~/.potalk-turn.env`、権限は `chmod 600`）に export 行を書き、起動前に `source ~/.potalk-turn.env` する運用を想定しています。**Worker の URL をリポジトリの既定値には入れません**（公開リポジトリに個人の運用先を固定しないため）。未設定＝TURN 無効、が既定の安全側です。

### 6. 確認する

`ptk` で部屋に入り、TUI の接続状態表示が `[ICE]TURN(relay)` になれば中継接続です。表示が STUN のままなら、Worker の URL・トークン・Secret の登録を見直してください（トークンなしのリクエストには Worker が 403 を返すのが正常です）。

## 運用

- **端末を増やす**：手順4でトークンを追加発行し、`CLI_TURN_TOKENS` に行を足して Worker を更新します
- **端末を失効させる**：`CLI_TURN_TOKENS` からその端末の行を消して Worker を更新します。即時にその端末は資格情報を取得できなくなります（接続中の通話は切れませんが、再接続時は STUN にフォールバックします）
- **TURN キーのローテーション**：新しい TURN キーを発行し、Worker の `TURN_KEY_ID`／`TURN_KEY_API_TOKEN` を差し替えます
- **費用**：Cloudflare TURN は無料枠の範囲で個人利用に収まる想定ですが、従量の条件は Cloudflare の現行ドキュメントで確認してください
