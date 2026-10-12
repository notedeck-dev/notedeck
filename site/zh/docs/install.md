---
sourceHash: e5cbbdfad684
---

# 安装

各操作系统的安装包发布在 [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest) 上。也可以从首页的[下载](/zh/#download)直接前往。

| 操作系统 | 格式 |
|---|---|
| Windows | `.exe`（安装程序）/ 便携版 `.zip` |
| macOS | `.dmg`（Universal — Intel / Apple Silicon 通用）/ `.app` 的 `.zip` |
| Linux | `.deb` / `.AppImage` / `.tar.gz`（应用本体 + notemaid + systemd user unit） |
| Android | `.apk`（按 CPU 分为 `arm64` / `armv7` / `x86_64` 3 种。绝大多数真机是 `arm64`） |

同一个 Release 中还有 AI 的独立进程 [notemaid](/zh/docs/notemaid) 和 CLI notecli 的独立二进制文件（面向 Linux 和 Apple Silicon 的 macOS）。应用已内置 notemaid，平时不需要它们。

## 包管理器

::: code-group

```powershell [winget (Windows)]
winget install NotedeckDev.NoteDeck
```

```bash [AUR (Arch Linux)]
yay -S misskey-notedeck-bin   # 内含 notemaid 和 user unit
yay -S notecli-bin            # 只想要 CLI 时
```

```bash [Nix Flake]
# 应用本体尚未通过 Nix 发布（请使用 AppImage 或 tarball）。
# flake 提供的是 notemaid（AI 的独立进程）和 CLI
nix profile install 'github:notedeck-dev/notedeck#notemaid'
nix profile install 'github:notedeck-dev/notedeck#notecli'
```

:::

要用 Nix 让 notemaid 常驻，请使用 flake 的 home-manager 模块（`services.notemaid.enable`）。应用内的常驻开关无法注册 Nix store 上的二进制文件。

## 首次启动时的警告

Windows / macOS 版目前尚未进行代码签名，首次启动时会出现“未知发布者”的警告。

- **Windows**：在 SmartScreen 界面中点击“更多信息”→“仍要运行”
- **macOS**：在系统设置 →“隐私与安全性”中，对被阻止的应用选择“仍要打开”（在较旧的 macOS 上，在访达中右键点击应用 →“打开”也可以）

没有签名是成本和审核的问题，并不是因为包含恶意代码。发布的文件由 GitHub Actions 从公开仓库的源代码构建，`.exe` / `.dmg` / `.deb` / `.AppImage` / `.tar.gz` 可以用 `SHA256SUMS.txt` 校验哈希值。

要消除警告，Windows 需要通过面向开源软件的免费代码签名（[SignPath Foundation](https://signpath.org/)）的审核，macOS 需要通过 Apple Developer Program 进行公证（notarization）。SignPath Foundation 以“无法为无人知晓的源代码签名”为由，会查看实际的使用情况，因此 [GitHub 上的 Star](https://github.com/notedeck-dev/notedeck) 数和下载量会直接成为依据。如果你愿意帮忙，请查看[下载页面底部的说明](/zh/#store-distribution)。

## 移动端

Android 版请直接安装 `.apk`。请选择与设备 CPU 匹配的版本（近年的设备基本都是 `arm64`）。如果系统询问是否允许安装未知来源的应用，请允许。

使用 [Obtainium](https://obtainium.imranr.dev/)，可以以 GitHub Releases 为来源自动跟进 APK 的更新。点击下方徽章，即可把预先配置好的设置交给 Obtainium。如果要手动添加，请在 Obtainium 的“添加应用”中粘贴仓库 URL `https://github.com/notedeck-dev/notedeck`。适合设备 CPU 的 APK 会被自动选择。

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

目前尚未在 Google Play / App Store 上发布。商店发布需要开发者账户的注册费，Google Play 还需要封闭测试的参与者。如果你愿意帮忙，请查看[下载页面底部的说明](/zh/#store-distribution)。

## 更新

用安装程序（`.exe` / `.dmg` / `.AppImage`）安装的桌面版，会在启动时检查并获取新版本。获取完成后会显示“更新已准备就绪”，重启后即切换到新版本。

如果是通过包管理器安装的，请按照包管理器的更新方式操作（`winget upgrade`、`yay -Syu` 等）。`.deb` / `.tar.gz` 同样需要手动重新安装新的 Release。

Android 版没有自动更新功能。使用 [Obtainium](#移动端) 可以接收 GitHub Releases 上新 APK 的通知并安装。

## 卸载后数据仍会保留

即使删除了应用，设置文件和帖子缓存仍会保留在操作系统的应用数据目录中。如果想彻底清除，请删除[设置文件夹](/zh/docs/config/files#设置在哪里)及其上一级的应用数据文件夹（里面有帖子缓存 `notecli.db` 和日志）。存入操作系统钥匙串的令牌会另外保留。

如果曾[让 notemaid 常驻](/zh/docs/notemaid#设为常驻)，请先关闭该开关（或执行 `notemaid service uninstall`），这样就不会留下指向已删除二进制文件的登录时任务。
