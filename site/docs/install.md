# インストール

各 OS 向けのインストーラは [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest) で配布しています。トップページの[ダウンロード](/#download)からも直接たどれます。

| OS | 形式 |
|---|---|
| Windows | `.exe`（インストーラ）/ portable の `.zip` |
| macOS | `.dmg`（Universal — Intel / Apple Silicon 共通）/ `.app` の `.zip` |
| Linux | `.deb` / `.AppImage` / `.tar.gz`（アプリ本体 + notemaid + systemd の user unit） |
| Android | `.apk`（CPU ごとに `arm64` / `armv7` / `x86_64` の 3 種。実機のほとんどは `arm64`） |

同じ Release に、AI の別プロセス [notemaid](/docs/notemaid) と CLI の notecli の standalone バイナリもあります（Linux と Apple Silicon の macOS 向け）。アプリには notemaid が同梱されているので、ふだんは要りません。

## パッケージマネージャー

::: code-group

```powershell [winget (Windows)]
winget install NotedeckDev.NoteDeck
```

```bash [AUR (Arch Linux)]
yay -S misskey-notedeck-bin   # notemaid と user unit を同梱
yay -S notecli-bin            # CLI だけ欲しいとき
```

```bash [Nix Flake]
# アプリ本体は Nix では未配布 (AppImage か tarball を使う)。
# flake が出すのは notemaid (AI の別プロセス) と CLI
nix profile install 'github:notedeck-dev/notedeck#notemaid'
nix profile install 'github:notedeck-dev/notedeck#notecli'
```

:::

Nix で notemaid を常駐させるには、flake の home-manager モジュール（`services.notemaid.enable`）を使います。アプリ内の常駐トグルは Nix store 上のバイナリを登録できません。

## 初回起動時の警告

Windows / macOS 版はまだコード署名なしで配布しているため、初回起動時に「発行元不明」の警告が出ます。

- **Windows**: SmartScreen の画面で「詳細情報」→「実行」
- **macOS**: システム設定 →「プライバシーとセキュリティ」で、ブロックされたアプリを「このまま開く」（古い macOS では Finder でアプリを右クリック →「開く」でも通ります）

署名がないのはコストと審査の問題で、悪意のあるコードが入っているわけではありません。配布物は GitHub Actions が公開リポジトリのソースからビルドしており、`.exe` / `.dmg` / `.deb` / `.AppImage` / `.tar.gz` は `SHA256SUMS.txt` でハッシュを検証できます。

警告をなくすには、Windows は OSS 向け無料コード署名（[SignPath Foundation](https://signpath.org/)）の審査を通すこと、macOS は Apple Developer Program での公証（notarization）が必要です。SignPath Foundation は「誰も知らないソースコードには署名できない」として実際に使われている実績を見るため、[GitHub の Star](https://github.com/notedeck-dev/notedeck) とダウンロード数がそのまま材料になります。協力できる方は[ダウンロードページ下部の案内](/#store-distribution)を見てください。

## モバイル

Android は `.apk` を直接インストールします。端末の CPU に合うものを選んでください（最近の端末はほぼ `arm64`）。提供元不明のアプリのインストール許可を求められたら、許可してください。

[Obtainium](https://obtainium.imranr.dev/) を使うと、GitHub Releases をソースにして APK の更新を自動で追従できます。下のバッジをタップすると設定済みの構成が Obtainium に渡ります。手動で追加する場合は Obtainium の「追加」にリポジトリ URL `https://github.com/notedeck-dev/notedeck` を貼り付けてください。端末の CPU に合う APK は自動で選ばれます。

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

Google Play / App Store での配布はまだ行っていません。ストア配布には開発者アカウントの登録費と、Google Play の場合はクローズドテストの参加者が必要なためです。協力できる方は[ダウンロードページ下部の案内](/#store-distribution)を見てください。

## アップデート

インストーラ（`.exe` / `.dmg` / `.AppImage`）で入れたデスクトップ版は、起動時に新しいバージョンを確認して取得します。取得が終わると「更新の準備ができました」と出るので、再起動すると切り替わります。

パッケージマネージャーで入れた場合は、そちらの更新手順に従ってください（`winget upgrade`、`yay -Syu` など）。`.deb` / `.tar.gz` も同様に、新しい Release を手で入れ直します。

Android 版は自動更新機能を持ちません。[Obtainium](#モバイル) を使うと GitHub Releases の新しい APK を通知・インストールできます。

## アンインストール後もデータは残る

アプリを削除しても、設定ファイルとノートのキャッシュは OS のアプリケーションデータ領域に残ります。完全に消したい場合は、[設定フォルダ](/docs/config/files#設定はどこにあるか)とその親のアプリデータフォルダ（ノートのキャッシュ `notecli.db` とログがある）を削除してください。OS のキーチェーンに入れたトークンは別に残ります。

[notemaid を常駐](/docs/notemaid#常駐にする)させていた場合は、先にトグルをオフにする（または `notemaid service uninstall`）と、消えたバイナリを指すログイン時タスクが残りません。
