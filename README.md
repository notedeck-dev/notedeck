<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="NoteDeck" width="96" />

# NoteDeck

**Misskey Pro — Misskey廃人のための Misskey 統合デッキ環境 (IDE: Integrated Deck Environment)**

[![CI](https://github.com/notedeck-dev/notedeck/actions/workflows/ci.yml/badge.svg)](https://github.com/notedeck-dev/notedeck/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/notedeck-dev/notedeck?style=flat-square)](https://github.com/notedeck-dev/notedeck/releases/latest)
[![winget](https://img.shields.io/badge/winget-NotedeckDev.NoteDeck-blue?style=flat-square&logo=windows)](https://github.com/microsoft/winget-pkgs/tree/master/manifests/n/NotedeckDev/NoteDeck)
[![AUR](https://img.shields.io/aur/version/misskey-notedeck-bin?style=flat-square&logo=archlinux&label=AUR)](https://aur.archlinux.org/packages/misskey-notedeck-bin)
[![Obtainium](https://img.shields.io/badge/Obtainium-Android-3ddc84?style=flat-square&logo=android&logoColor=white)](https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D)
[![Nix Flake](https://img.shields.io/badge/nix-flake-blue?style=flat-square&logo=nixos)](https://github.com/notedeck-dev/notedeck)
[![License](https://img.shields.io/github/license/notedeck-dev/notedeck?style=flat-square)](https://github.com/notedeck-dev/notedeck/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/notedeck-dev/notedeck?style=flat-square)](https://github.com/notedeck-dev/notedeck/stargazers)
[![GitHub Downloads](https://img.shields.io/github/downloads/notedeck-dev/notedeck/total?style=flat-square)](https://github.com/notedeck-dev/notedeck/releases)
[![GitHub last commit](https://img.shields.io/github/last-commit/notedeck-dev/notedeck?style=flat-square)](https://github.com/notedeck-dev/notedeck/commits)
[![GitHub Issues](https://img.shields.io/github/issues/notedeck-dev/notedeck?style=flat-square)](https://github.com/notedeck-dev/notedeck/issues)
[![Made with Tauri](https://img.shields.io/badge/Made%20with-Tauri-ffc131?style=flat-square&logo=tauri)](https://tauri.app)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/notedeck-dev/notedeck/pulls)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/notedeck-dev/notedeck)
[![misskey.io](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmisskey.io%2Fusers%2Fanl48t0qf1ns05tf%2Ffollowers&query=%24.totalItems&logo=misskey&logoColor=fff&label=misskey.io&color=86b300)](https://misskey.io/@notedeck)

[Download](https://github.com/notedeck-dev/notedeck/releases/latest) ·
[Issues](https://github.com/notedeck-dev/notedeck/issues) ·
[Roadmap](ROADMAP.md) ·
[Strategy](STRATEGY.md) ·
[Architecture](ARCHITECTURE.md) ·
[Design](DESIGN.md) ·
[Development](DEVELOPMENT.md) ·
[Performance](PERFORMANCE.md) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md)

</div>

<img width="1194" height="793" alt="スクリーンショット 2026-05-03 095616" src="https://github.com/user-attachments/assets/a9bca10d-a59d-4c35-9284-fb0534ccf886" />

## Install

| Windows | macOS | Linux | Android |
|---|---|---|---|
| `.exe` | `.dmg` (Universal) | `.deb` / `.AppImage` | `.apk` |

**Windows (winget)**

```
winget install NotedeckDev.NoteDeck
```

**Arch Linux (AUR)**

```bash
yay -S misskey-notedeck-bin
```

**Nix Flake**

```bash
nix run github:notedeck-dev/notedeck
```

**Android (Obtainium)**

[<img src="site/public/badge_obtainium.png" alt="Get it on Obtainium" height="48" />](https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D)

[Obtainium](https://obtainium.imranr.dev/) に GitHub Releases をソースとして登録すると、新しいバージョンが出るたびに APK の更新を自動で追従できます。バッジをタップすると設定済みの構成が Obtainium に渡ります。手動で追加する場合は Obtainium の「追加」にリポジトリ URL `https://github.com/notedeck-dev/notedeck` を貼り付けてください。端末の CPU に合う APK は自動で選ばれます。

## 貢献する

PR を歓迎します。詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

[AGPL-3.0](LICENSE)
