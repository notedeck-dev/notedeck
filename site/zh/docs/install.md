---
sourceHash: 8ff2c7d208fc
---

# 安装

各操作系统的安装包发布在 [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest) 上。也可以从首页的[下载](/zh/#download)直接前往。

| 操作系统 | 格式 |
|---|---|
| Windows | `.exe`（安装程序） |
| macOS | `.dmg`（Universal — Intel / Apple Silicon 通用） |
| Linux | `.deb` / `.AppImage` |
| Android | `.apk` |

## 包管理器

::: code-group

```powershell [winget (Windows)]
winget install NotedeckDev.NoteDeck
```

```bash [AUR (Arch Linux)]
yay -S misskey-notedeck-bin
```

```bash [Nix Flake]
# 应用本体尚未通过 Nix 发布（请使用 AppImage 或 tarball）。
# flake 提供的是 notemaid（AI 的独立进程）和 CLI
nix profile add 'github:notedeck-dev/notedeck#notemaid'
nix profile add 'github:notedeck-dev/notedeck#notecli'
```

:::

## 首次启动时的警告

Windows / macOS 版目前尚未进行代码签名，首次启动时会出现“未知发布者”的警告。

- **Windows**：在 SmartScreen 界面中点击“更多信息”→“仍要运行”
- **macOS**：在访达中右键点击应用 →“打开”→ 再次点击“打开”（也可以在系统设置 →“隐私与安全性”中允许）

没有签名是成本和审核的问题，并不是因为包含恶意代码。发布的文件由 GitHub Actions 从公开仓库的源代码构建，可以用 `SHA256SUMS.txt` 校验哈希值。

要消除警告，Windows 需要通过面向开源软件的免费代码签名（[SignPath Foundation](https://signpath.org/)）的审核，macOS 需要通过 Apple Developer Program 进行公证（notarization）。SignPath Foundation 以“无法为无人知晓的源代码签名”为由，会查看实际的使用情况，因此 [GitHub 上的 Star](https://github.com/notedeck-dev/notedeck) 数和下载量会直接成为依据。如果你愿意帮忙，请查看[下载页面底部的说明](/zh/#store-distribution)。

## 移动端

Android 版请直接安装 `.apk`。如果系统询问是否允许安装未知来源的应用，请允许。

使用 [Obtainium](https://obtainium.imranr.dev/)，可以以 GitHub Releases 为来源自动跟进 APK 的更新。点击下方徽章，即可把预先配置好的设置交给 Obtainium。如果要手动添加，请在 Obtainium 的“添加应用”中粘贴仓库 URL `https://github.com/notedeck-dev/notedeck`。适合设备 CPU 的 APK 会被自动选择。

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

目前尚未在 Google Play / App Store 上发布。商店发布需要开发者账户的注册费，Google Play 还需要封闭测试的参与者。如果你愿意帮忙，请查看[下载页面底部的说明](/zh/#store-distribution)。

## 更新

桌面版支持自动更新。新版本发布后，启动时会收到通知，可以当场更新。

如果是通过包管理器安装的，请按照包管理器的更新方式操作（`winget upgrade`、`yay -Syu` 等）。

Android 版没有自动更新功能。使用 [Obtainium](#移动端) 可以接收 GitHub Releases 上新 APK 的通知并安装。

## 卸载后数据仍会保留

即使删除了应用，设置文件和帖子缓存仍会保留在操作系统的应用数据目录中。如果想彻底清除，请删除[设置文件](/zh/docs/config/files#设置在哪里)中所述的整个文件夹。
