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

## モバイル

Android は `.apk` を直接インストールします。提供元不明のアプリのインストール許可を求められたら、許可してください。

Google Play / App Store での配布はまだ行っていません。ストア配布には開発者アカウントの登録費と、Google Play の場合はクローズドテストの参加者が必要なためです。協力できる方は[ダウンロードページ下部の案内](/#store-distribution)を見てください。

## アップデート

デスクトップ版は自動更新に対応しています。新しいバージョンが出ると起動時に通知され、その場で更新できます。

パッケージマネージャーで入れた場合は、そちらの更新手順に従ってください（`winget upgrade`、`yay -Syu` など）。

## アンインストール後もデータは残る

アプリを削除しても、設定ファイルとノートのキャッシュは OS のアプリケーションデータ領域に残ります。完全に消したい場合は[設定ファイル](/docs/config/files#設定はどこにあるか)のフォルダごと削除してください。
