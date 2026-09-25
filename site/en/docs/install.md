---
sourceHash: edb525000ecb
---

# Installation

Installers for each OS are published on [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest). You can also get them from [Download](/en/#download) on the top page.

| OS | Format |
|---|---|
| Windows | `.exe` (installer) |
| macOS | `.dmg` (Universal — Intel and Apple Silicon) |
| Linux | `.deb` / `.AppImage` |
| Android | `.apk` |

## Package managers

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

## Warning on first launch

The Windows and macOS builds are not code-signed yet, so you will see an "unknown publisher" warning on first launch.

- **Windows**: on the SmartScreen dialog, click "More info" → "Run anyway"
- **macOS**: right-click the app in Finder → "Open" → "Open" again (you can also allow it from System Settings → "Privacy & Security")

The missing signature is a matter of cost and review, not malicious code. Releases are built by GitHub Actions from the source in the public repository, and you can verify their hashes with `SHA256SUMS.txt`.

Removing the warning requires passing review for free open-source code signing from [SignPath Foundation](https://signpath.org/) on Windows, and notarization through the Apple Developer Program on macOS. SignPath Foundation will not sign code nobody knows about and looks at real-world usage, so [stars on GitHub](https://github.com/notedeck-dev/notedeck) and download counts count directly. If you can help, see [the section at the bottom of the download page](/en/#store-distribution).

## Mobile

On Android, install the `.apk` directly. If you are asked to allow installing apps from unknown sources, allow it.

With [Obtainium](https://obtainium.imranr.dev/), you can follow APK updates automatically using GitHub Releases as the source. Tap the badge below to hand a preconfigured setup to Obtainium. To add it manually, paste the repository URL `https://github.com/notedeck-dev/notedeck` into Obtainium's "Add App". The APK matching your device's CPU is picked automatically.

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

NoteDeck is not on Google Play or the App Store yet. Store distribution needs developer account fees and, for Google Play, participants for a closed test. If you can help, see [the section at the bottom of the download page](/en/#store-distribution).

## Updates

The desktop builds update themselves. When a new version is out, you are notified on launch and can update right there.

If you installed with a package manager, follow its update procedure instead (`winget upgrade`, `yay -Syu` and so on).

The Android build has no auto-update. [Obtainium](#mobile) can notify you about new APKs on GitHub Releases and install them.

## Your data stays after uninstalling

Removing the app leaves the settings files and the note cache in your OS's application data folder. To erase everything, delete the whole folder described in [Settings files](/docs/config/files#設定はどこにあるか) (Japanese).
