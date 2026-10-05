# potalk-cli

[ぽっと通話 (po-talk.github.io)](https://github.com/po-talk/po-talk.github.io) の派生CLI版です。

## これはなに？

ブラウザベースで動く「ぽっと通話」のコア機能と外見を分離してみたらどうなるか？というテストの一環として作成した、ターミナル向けのクライアント（CLI版）です。

vimjpやNostrのどこかに生息しているであろう、黒い画面を愛する**Vimmerに向けた熱いラブコール**でもあります（笑）。

## なぜ Node.js なのか？

GoやRustといった渋い言語も検討しましたが、動いている元のHTML/JavaScriptからコードやモジュールを「うまく拝借（移植）」しながらスピーディーに形にするため、今回は **Node.js** を選択しました。

## 使い方

Node.js 18 以上が必要です。

```bash
npm install
npm link          # ptk コマンドとして使えるようにする（任意）

ptk               # ロビーを TUI で表示（j/k で移動、r で再読み込み、q で終了）
ptk list          # 通話中の部屋を一覧で出力（--seconds N で待ち時間、既定 15 秒）
ptk help
```

本家ブラウザ版と同じロビー・同じ Nostr リレーに乗り入れているので、ブラウザ版で通話中の部屋がそのまま見えます。
`ptk create` / `ptk join` はまだ実装されていません。

## 作者

田上光 (Mitsuru Tagami)

## ライセンス

元リポジトリに準拠し、本プロジェクトも MITライセンス となります。
詳細は LICENSE ファイルをご確認ください。
