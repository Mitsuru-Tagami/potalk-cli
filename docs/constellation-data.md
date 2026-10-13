# 88星座データの出典

## 収録内容

`data/constellations.json` には、国際天文学連合（IAU）が定める88星座について、日本語名、ラテン名、IAU略符、短い説明を収録しています。日本語名・ラテン名・略符は国立天文台の一覧に基づき、説明はNASA/GSFC StarChildの「88 Officially Recognized Constellations」に示された各星座名の意味・モチーフを参照し、このプロジェクト向けに日本語で書き起こしました。表示用の解説は一行・60文字以内です。

- IAU, [The Constellations](https://www.iau.org/public/themes/constellations/) — 88星座と全天を覆う境界の定義
- 国立天文台, [星座名・星座略符一覧](https://www.nao.ac.jp/new-info/constellation.html) — 88星座の日本語名、ラテン名、略符
- NASA/GSFC StarChild, [88 Officially Recognized Constellations](https://starchild.gsfc.nasa.gov/docs/StarChild/questions/88constellations.html) — 星座名が表す人物・動物・道具など

説明は天体観測の暦や、星座占いの科学的根拠を示すものではありません。神話・名称の由来には複数の伝承がある場合があり、短い説明では代表的な意味を紹介しています。検索では日本語名のほか、`座` を省いた名前、データに登録した別表記、ラテン名、IAU略符も使用できます。

## コマンド

- `/seiza [星座名]` — 88星座から一つ選んで解説を送信。名前を指定するとその星座を表示
- `/uranai [12星座]` — 12星座占いを独立したコマンドとして提供
- `/omikuji` — 従来どおりのおみくじ
