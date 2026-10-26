# SPEC ― potalk-cli の構成

potalk-cli の現在の構成をまとめた仕様メモです。使い方は [README](README.md) と [使い方マニュアル](docs/manual.md)、細部の仕様は [リファレンス](docs/reference.md) を参照してください。

（このファイルは当初、実装前の計画・ロードマップを置く場所でした。実装が進んだため、2026-10-27 に現行構成の記述へ書き換えました。計画当時の内容は git の履歴にあります。）

## 位置づけ

- 本家「ぽっと通話」（[po-talk/po-talk.github.io](https://github.com/po-talk/po-talk.github.io)、ブラウザ版）の派生クライアント。本家と同じロビー・部屋に参加できるターミナル向け実装で、本家の全機能版ではない
- 通常部屋では送受話ができ、配信部屋では聞き役として参加する
- ターゲットはターミナルから離れたくない利用者（Vimmer、Nostr・vimjp 周辺）

## 技術スタック

- **言語／ランタイム**：Node.js（ES Modules）。Node.js 20.6以上、22推奨
- **主要な依存**（版は固定。内部実装に依存した回避策があるため）：
  - `trystero` 0.25.4 ― Nostr 戦略によるシグナリングと P2P 接続
  - `@roamhq/wrtc` 0.10.0 ― Node 用 WebRTC（libwebrtc）
  - `blessed` 0.1.81 ― TUI
  - `nostr-tools` 2.20.0、`ws` ― Nostr／WebSocket 補助
- **音声 I/O**：SoX の `play`（受信再生）／`rec`（マイク取得）。PipeWire 環境の BOT 連携では `pw-cat` も使う

## モジュール構成

- `ptk.mjs`：エントリーポイント（コマンド振り分け）
- `commands/`：各サブコマンドと画面（`lobby`、`list`、`join`、`roomview`、名刺編集、ボス画面、イースターエッグ画面）
- `lib/`：機能モジュール群
  - 接続・部屋：`config.mjs`（設定と接続構成）、`lobby.mjs`、`room.mjs`、`session.mjs`、`turn.mjs`（TURN 資格情報の取得と差し替え）
  - 音声：`audio.mjs`、`mic.mjs`、`mic-level.mjs`、`mic-diagnostic.mjs`、`bot-audio.mjs`（BOT 連携契約）
  - プロトコル：`card.mjs`／`card-proof.mjs`（名刺と本人確認）、`roster.mjs`（配信名簿）、`oath.mjs`（配信者の本人確認）、`events.mjs`（JSONL 出力）
  - UI・その他：`tui.mjs`、`profile.mjs`、`growth.mjs`、`text.mjs`（文字整形）、`tts.mjs`、`commands.mjs`（部屋内コマンド）、`dice.mjs`／`poems.mjs`／`fortune.mjs`（遊びコマンド）、`clipboard.mjs`、`polyfill.mjs`

## 通信

- シグナリングは本家と同じ Trystero の Nostr 戦略（`appId: 'kuramo-webrtc-call'`、隠しロビー `__lobby__`）を使い、本家と同じ Nostr リレー群に接続する。リレーの一覧は本家と同期して保つ（ずれると互いに見えなくなる）
- 部屋の在室はロビーへ告知する（秘密の部屋を作れない、という本家の決まりに従う）
- 音声は WebRTC で直接やり取りする。TURN を設定した場合は中継（relay）のみで接続する（[TURN ガイド](docs/turn.md)）

## データの保存

設定は `$XDG_CONFIG_HOME/ptk/`（未設定時は `~/.config/ptk/`）に置く：名乗り（`profile.json`）、成長記録（`growth.json`）、名刺（`card.json`）、名刺の鍵（`card-key.json`、0600）。詳細は [リファレンス](docs/reference.md#設定ファイル)。

## 本家との差

本家との機能・プロトコルの差は [本家との差異メモ](potalk-cli-vs-po-talk.md) が正本です。要点：配信まわりの未対応 action 群（Issue #58）が主な未対応として残り、それ以外（リレー同期・文字整形・大音量ガード・TURN）は追随・解決済みです。
