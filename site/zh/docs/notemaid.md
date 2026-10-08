---
sourceHash: 0af060a8bcf3
---

# AI 的独立进程 (notemaid)

NoteDeck 的 AI（智能体循环和 HEARTBEAT）运行在独立于应用的进程 **notemaid** 中。时间线的获取、存档、订阅以及 Deck 都在应用内运行，notemaid 只负责 AI。平时你无需在意它：应用启动时会把内置的 notemaid 作为子进程启动，退出时一起结束。

## 两种运行方式

| 形式 | 由谁启动 | 能做什么 |
|---|---|---|
| 默认（子进程） | 应用 | 无需设置。随应用启动，随应用结束。只要关闭窗口后应用仍留在托盘中，AI 也会继续运行 |
| 常驻 | 操作系统的登录时任务（AI 设置中的开关） | 即使完全退出应用，HEARTBEAT 也会继续。下次打开应用时会自动连接到它 |

两种方式都运行在同一台设备上。我们没有提供连接到在其他设备或自己的服务器上运行的 notemaid 的方式（能得到的只有巡查的持续运行，与常驻相同，而认证和密钥存放的麻烦却很大）。

应用启动时会先检查是否有常驻的 notemaid，有就连接，没有就启动子进程。无论哪种方式，数据（存档、订阅、Deck）都留在设备上，notemaid 使用应用的设置以及操作系统钥匙串中相同账户的令牌（不会打开应用的数据库）。版本必须与应用一致（不一致时，AI 设置中会显示原因）。

## 设为常驻

只有在完全关闭应用后仍希望 HEARTBEAT 继续运行时才需要设置。打开设置菜单的 **AI 设置** → HEARTBEAT，开启“退出应用后继续运行”（アプリを終了しても続ける），就会注册为操作系统的登录时任务（Linux 为 systemd 的 user unit，macOS 为 LaunchAgent，Windows 为每个用户的 Run 键（登录时自动启动）），并当场切换（无需重启）。关闭后会取消注册，恢复为子进程。

AppImage 每次启动时的挂载位置都会变化，因此无法使用这个开关。请把 Releases 中的 standalone 二进制文件放到 PATH 中的位置，然后手动注册。

```bash
notemaid service install    # 准备登录时任务
notemaid service enable     # 注册并启动
```

在 Linux 上，如果希望登出后仍继续运行，请设置 `loginctl enable-linger`。停止时使用 `notemaid service stop`，不再需要时使用 `uninstall`。

如果只想连接常驻的 notemaid（不希望启动子进程），请把设置文件夹中的 `client.json5` 设为 `{ backend: "resident" }`。反之，如果总想在进程内运行（用于开发或排查问题），请设为 `{ backend: "embedded" }`。默认为 `auto`。

## 前提条件

- Linux 上的常驻需要 systemd 的 **user 会话**正在运行（`systemctl --user status` 能正常执行）。在 WSL2 中，请在 `/etc/wsl.conf` 中启用 systemd
- 常驻的 socket 存放位置需要 `XDG_RUNTIME_DIR`。子进程没有它也能运行（会使用临时目录）

## 遇到问题时

- **日志**：子进程以及 macOS / Windows 上的常驻进程写入数据目录中的 `logs/notemaid.log`；Linux 上的常驻进程请使用 `journalctl --user -u notemaid -e`
- **版本不一致**：请把 notemaid 更新到与应用相同的版本。子进程是内置的，所以版本始终一致
- **notemaid 自行停止**：遇到重启也无法解决的状态（另一个 notemaid 正在使用同一个数据目录、无法读取 secret 的密钥）时，它会以专用的退出码停止，systemd 不会重启它。原因会写在日志中

## notemaid 管理的文件

notemaid 只写入设置文件夹中属于自己的内容：AI 的人格与记忆（`notemaid/`）、AI 会话（`sessions/`）、备忘（`memos/`）、技能（`skills/`）以及 AI 设置（`ai.json5`）。它不会打开应用的数据库。人格与记忆的内容可以在 AI 设置的“AI 的人格与记忆”（AI の人格と記憶）中读写，文件列表请参阅[设置文件](/zh/docs/config/files)。

## 命令

```bash
notemaid run                 # 在前台运行
notemaid status              # 正在运行的 notemaid 的状态
notemaid service install     # 准备登录时任务（不启动）
notemaid service enable      # 注册并启动
notemaid service status | stop | restart | uninstall
```
