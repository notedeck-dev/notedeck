# インストール

各 OS 向けのインストーラは [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest) で配布しています。トップページの[ダウンロード](/#download)からも直接たどれます。

| OS | 形式 |
|---|---|
| Windows | `.exe`（インストーラ） |
| macOS | `.dmg`（Universal — Intel / Apple Silicon 共通） |
| Linux | `.deb` / `.AppImage` |
| Android | `.apk` |

## パッケージマネージャー

::: code-group

```powershell [winget (Windows)]
winget install NotedeckDev.NoteDeck
```

```bash [AUR (Arch Linux)]
yay -S misskey-notedeck-bin
```

```bash [Nix Flake]
nix run github:notedeck-dev/notedeck
```

:::

## 初回起動時の警告

Windows / macOS 版はまだコード署名なしで配布しているため、初回起動時に「発行元不明」の警告が出ます。

- **Windows**: SmartScreen の画面で「詳細情報」→「実行」
- **macOS**: Finder でアプリを右クリック →「開く」→ もう一度「開く」（システム設定 →「プライバシーとセキュリティ」から許可する方法もあります）

署名がないのはコストと審査の問題で、悪意のあるコードが入っているわけではありません。配布物は GitHub Actions が公開リポジトリのソースからビルドしており、`SHA256SUMS.txt` でハッシュを検証できます。

警告をなくすには、Windows は OSS 向け無料コード署名（[SignPath Foundation](https://signpath.org/)）の審査を通すこと、macOS は Apple Developer Program での公証（notarization）が必要です。SignPath Foundation は「誰も知らないソースコードには署名できない」として実際に使われている実績を見るため、[GitHub の Star](https://github.com/notedeck-dev/notedeck) とダウンロード数がそのまま材料になります。協力できる方は[ダウンロードページ下部の案内](/#store-distribution)を見てください。

## モバイル

Android は `.apk` を直接インストールします。提供元不明のアプリのインストール許可を求められたら、許可してください。

[Obtainium](https://obtainium.imranr.dev/) を使うと、GitHub Releases をソースにして APK の更新を自動で追従できます。下のバッジをタップすると設定済みの構成が Obtainium に渡ります。手動で追加する場合は Obtainium の「追加」にリポジトリ URL `https://github.com/notedeck-dev/notedeck` を貼り付けてください。端末の CPU に合う APK は自動で選ばれます。

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

Google Play / App Store での配布はまだ行っていません。ストア配布には開発者アカウントの登録費と、Google Play の場合はクローズドテストの参加者が必要なためです。協力できる方は[ダウンロードページ下部の案内](/#store-distribution)を見てください。

## アップデート

デスクトップ版は自動更新に対応しています。新しいバージョンが出ると起動時に通知され、その場で更新できます。

パッケージマネージャーで入れた場合は、そちらの更新手順に従ってください（`winget upgrade`、`yay -Syu` など）。

Android 版は自動更新機能を持ちません。[Obtainium](#モバイル) を使うと GitHub Releases の新しい APK を通知・インストールできます。

## アンインストール後もデータは残る

アプリを削除しても、設定ファイルとノートのキャッシュは OS のアプリケーションデータ領域に残ります。完全に消したい場合は[設定ファイル](/docs/config/files#設定はどこにあるか)のフォルダごと削除してください。
