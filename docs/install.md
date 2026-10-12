# OS別の導入ガイド

`potalk-cli` は Node.js で動作するターミナル用クライアントです。このページでは Windows、macOS、Linux での準備から初回起動までを説明します。

## 必要なもの

- **Node.js 20.6以上**。ネイティブWebRTC依存の対応範囲に合わせ、Node.js **22.xを推奨**します。
- Git（ソースコードの取得に使います）。
- 音声を聞く・話す場合は SoX の `play` と `rec` コマンド。**音声を使わず起動するだけなら SoX は省略**でき、`ptk --no-sound` を使えます。

`@roamhq/wrtc` は Node.js 22 の Windows x64、macOS x64／arm64向けの事前ビルドを公開しています（[対応プラットフォーム](https://github.com/WonderInventions/node-webrtc#supported-platforms)）。一方、このリポジトリのCIはLinuxとmacOSで実行しており、WindowsはCI対象ではありません。Windowsではx64環境を推奨します。Windows ARM64は同依存の事前ビルド対象として記載されていないため、ここでは動作未確認です。

## Windows

### 1. Node.jsとGitを用意する

1. [Node.js公式ダウンロードページ](https://nodejs.org/en/download/)から **Node.js 22.xのWindows x64インストーラー**をダウンロードしてインストールします。
2. Gitがまだなければ[Git for Windows](https://git-scm.com/download/win)をインストールします。
3. PowerShellを新しく開き、バージョンを確認します。

```powershell
node --version
npm --version
git --version
```

`node --version` が `v22` で始まることを確認してください。

### 2. CLIをインストールする

PowerShellでリポジトリを取得し、依存関係をインストールします。

```powershell
git clone https://github.com/Mitsuru-Tagami/potalk-cli.git
Set-Location .\potalk-cli
npm ci
node .\ptk.mjs help
```

`ptk` コマンドをどのフォルダーからでも使いたい場合は、リポジトリのルートで次を実行します。

```powershell
npm link
ptk help
```

リンクせずに使う場合は、リポジトリのルートで `node .\ptk.mjs` を実行してください。

### 3. 音声を使う場合はSoXを用意する

[SoXの配布ページ](https://sourceforge.net/projects/sox/)からWindows向けの配布物を入手して展開します。`sox.exe` と同梱DLLが同じフォルダーにある場合は、その配置を保ってください。SoXのWindows向け案内では、`play.exe` と `rec.exe` は `sox.exe` のコピーとして用意できます。

展開先フォルダーを次の例のように設定し、`play.exe`／`rec.exe` がまだ存在しない場合だけ作成します。`$soxDir` は実際の展開先に置き換えてください。

```powershell
$soxDir = "$env:USERPROFILE\Tools\SoX"
foreach ($name in 'play', 'rec') {
  $target = Join-Path $soxDir "$name.exe"
  if (-not (Test-Path $target)) {
    Copy-Item (Join-Path $soxDir 'sox.exe') $target
  }
}
$env:Path = "$soxDir;$env:Path"
Get-Command play, rec
```

`Get-Command` が両方の場所を表示すれば、このPowerShellから利用できます。毎回設定しなくてよいようにするには、Windowsの「環境変数を編集」からユーザー環境変数 `Path` にSoXのフォルダーを追加し、ターミナルを開き直してください。

### 4. 起動する

```powershell
ptk                 # ロビーを開く（npm link 済みの場合）
ptk --no-sound      # SoXなしでロビーを開く
ptk join 'https://potalk.app/#room=…&name=…'
```

## macOS

### 1. Node.jsとGitを用意する

[Node.js公式ダウンロードページ](https://nodejs.org/en/download/)から **Node.js 22.xのmacOSインストーラー**を選んでインストールします。Intel MacかApple Siliconかに合うインストーラーを選んでください。Gitが見つからない場合は、ターミナルで `git --version` を実行し、表示された案内に従ってXcode Command Line Toolsをインストールします。

```bash
node --version
npm --version
git --version
```

### 2. SoXをインストールする

[Homebrew](https://brew.sh/)を利用している場合は次のコマンドでSoXを入れます。

```bash
brew install sox
command -v play
command -v rec
```

### 3. CLIをインストールして起動する

```bash
git clone https://github.com/Mitsuru-Tagami/potalk-cli.git
cd potalk-cli
npm ci
node ./ptk.mjs help
```

`ptk` コマンドをどのフォルダーからでも使う場合は、リポジトリのルートで任意にリンクします。

```bash
npm link
ptk help
```

### 4. マイクを使う

マイクは入室時にはオフで、TUIの `t` キー（行表示では `/mic`）でオンにしたときだけ録音コマンドが起動します。macOSがマイクへのアクセスを尋ねたら、使っているターミナルアプリに許可を与えてください。あとから変更する場合は「システム設定」→「プライバシーとセキュリティ」→「マイク」を確認します。

## Linux

Node.js 20.6以上とGitを用意してください。Debian／Ubuntu系ではSoXを次のようにインストールできます。

```bash
sudo apt update
sudo apt install sox git
```

Node.jsの導入方法はディストリビューションにより異なります。Node.js公式の[ダウンロードページ](https://nodejs.org/en/download/)または[npmの案内](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/)を参照してください。その後はmacOSと同じ要領でリポジトリを取得し、`npm ci` を実行します。

VOICEVOX／COEIROINKを使ったBYOE読み上げ例は、現在はLinux Mint向けに別ページで説明しています：[VOICEVOX](voicevox-tts.md)・[COEIROINK](coeiroink-tts.md)。

## インストール後の確認

`ptk help` または `node ptk.mjs help` でコマンド一覧が表示されたらCLIの導入は完了です。ロビーを試すときは `ptk`、音声を使わず起動する場合は `ptk --no-sound` を実行します。入室後、マイクは必要なときだけオンにしてください。CLIにはブラウザーのようなエコーキャンセルがないため、通話ではヘッドホンを推奨します。

CLIは相手と直接通信するため、**あなたのIPアドレスが相手から見える場合があります**。詳しくは[README](../README.md)冒頭の警告を確認してください。

## トラブルシューティング

- **`ptk` が見つからない**: `npm link` を実行したか確認します。リンクを使わない場合は、リポジトリ内から `node ptk.mjs`（Windowsでは `node .\ptk.mjs`）を実行します。
- **`play`／`rec` が見つからない**: SoXのフォルダーが `PATH` に含まれ、Windowsでは `play.exe` と `rec.exe` が存在するか確認します。
- **音が出ない／マイクが入らない**: SoX、OSの音声デバイス設定、ターミナルアプリのマイク許可を確認します。`--no-sound` は再生を無効にするオプションです。
- **`@roamhq/wrtc` のインストールに失敗する**: Node.js 22.xを使っていることを確認し、Windows ARM64の場合はx64環境での利用を検討してください。

## 参考

- [Node.js公式ダウンロード](https://nodejs.org/en/download/)
- [npm公式: Node.jsとnpmの導入](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/)
- [@roamhq/wrtcの対応プラットフォーム](https://github.com/WonderInventions/node-webrtc#supported-platforms)
- [SoXのダウンロード](https://sourceforge.net/projects/sox/)
- [SoX for Windows README](https://github.com/mansr/sox/blob/master/README.win32)
- [HomebrewのSoX formula](https://formulae.brew.sh/formula/sox)
