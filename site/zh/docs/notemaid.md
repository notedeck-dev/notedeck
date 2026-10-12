---
sourceHash: bdb9cc5cbe62
---

# AI 的独立进程 (notemaid)

NoteDeck 的 AI（智能体循环和 HEARTBEAT）运行在独立于应用的进程 **notemaid** 中。时间线的获取、存档、订阅以及 Deck 都在应用内运行，notemaid 只负责 AI。平时你无需在意它：应用启动时会把内置的 notemaid 作为子进程启动，退出时一起结束。

## 两种运行方式

| 形式 | 由谁启动 | 能做什么 |
|---|---|---|
| 默认（子进程） | 应用 | 无需设置。随应用启动，随应用结束。只要关闭窗口后应用仍留在托盘中，AI 也会继续运行 |
| 常驻 | 操作系统的登录时任务（智能体设置中的开关） | 即使完全退出应用，HEARTBEAT 也会继续。下次打开应用时会自动连接到它，关闭期间的报告会汇总送达应用通知 |

两种方式都运行在同一台设备上。我们没有提供连接到在其他设备或自己的服务器上运行的 notemaid 的方式（能得到的只有巡查的持续运行，与常驻相同，而认证和密钥存放的麻烦却很大）。

应用启动时会先检查是否有常驻的 notemaid，有就连接，没有就启动子进程。没有内置的 notemaid 或启动失败时，会在应用内部运行（**关于 NoteDeck** 的自我诊断中会显示“正在应用内运行”及其原因）。无论哪种方式，数据（存档、订阅、Deck）都留在设备上，notemaid 使用应用的设置以及操作系统钥匙串中相同账户的令牌（不会打开应用的数据库）。版本必须与应用一致（不一致时，自我诊断中会显示原因）。

## 设为常驻

只有在完全关闭应用后仍希望 HEARTBEAT 继续运行时才需要设置。打开设置菜单的**智能体**（エージェント）→ HEARTBEAT，开启“退出应用后继续运行”（アプリを終了しても続ける）（托盘菜单中的“退出应用后仍运行 AI”也是同一个开关），就会注册为操作系统的登录时任务（Linux 为 systemd 的 user unit，macOS 为 LaunchAgent，Windows 为每个用户的 Run 键（登录时自动启动）），并当场切换（无需重启）。关闭后会取消注册，恢复为子进程。

常驻带来的好处是巡视不会中断。报告保存在 HEARTBEAT 的会话中，应用关闭期间收到的报告会在下次打开应用时，以“关闭期间的报告”汇总为一条显示在应用通知中（如有等待确认的操作也会一并显示）。应用关闭期间不会显示操作系统的通知。

AppImage 每次启动时的挂载位置都会变化，因此无法使用这个开关。请把 Releases 中的 standalone 二进制文件（如 `notemaid-<版本>-linux-amd64`。选择与应用相同的版本，重命名为 `notemaid` 并赋予执行权限）放到 PATH 中的位置，然后手动注册。用 Nix 安装的 notemaid 也一样，用 `--exec-path` 传入位置，或使用 flake 的 home-manager 模块。

```bash
notemaid service install                      # 准备登录时任务
notemaid service install --exec-path /path/to/notemaid   # 放在 PATH 之外的位置时
notemaid service enable                       # 注册并启动
```

在 Linux 上，如果希望登出后仍继续运行，请设置 `loginctl enable-linger`。停止时使用 `notemaid service stop`，不再需要时使用 `uninstall`。

如果只想连接常驻的 notemaid（不希望启动子进程），请把设置文件夹中的 `client.json5` 设为 `{ backend: "resident" }`。如果没有注册登录时任务，会退回 `auto` 并以子进程运行。反之，如果总想在应用内部运行（用于开发或排查问题），请设为 `{ backend: "embedded" }`。默认为 `auto`。这个文件是每台设备各自的，不包含在[备份](/zh/docs/config/backup)中。

## 前提条件

- Linux 上的常驻需要 systemd 的 **user 会话**正在运行（`systemctl --user status` 能正常执行）。在 WSL2 中，请在 `/etc/wsl.conf` 中启用 systemd
- 常驻的 socket 存放位置需要 `XDG_RUNTIME_DIR`。没有的话，常驻会以专用的退出码停止。子进程没有它也能运行（会使用临时目录）

## 遇到问题时

- **日志**：子进程以及 macOS / Windows 上的常驻进程写入应用数据文件夹中的 `logs/notemaid.log.<日期>`（按天分割）；Linux 上的常驻进程请使用 `journalctl --user -u notemaid -e`
- **版本不一致**：请把 notemaid 更新到与应用相同的版本。子进程是内置的，所以版本始终一致
- **notemaid 自行停止**：遇到重启也无法解决的状态（另一个 notemaid 正在使用同一个数据目录、没有 `XDG_RUNTIME_DIR`、无法读取 secret 的密钥）时，它会以专用的退出码停止，systemd 不会重启它。原因会写在日志中

## notemaid 管理的文件

notemaid 只写入设置文件夹中属于自己的内容：AI 的人格与记忆（`notemaid/`）、AI 会话（`sessions/`）、备忘（`memos/`）、技能（`skills/`）以及 AI 设置（`ai.json5`）。它不会打开应用的数据库。从应用复制过来的账户列表（`notemaid-accounts.json`，不含令牌）放在应用数据文件夹中。在没有 Secret Service 的 Linux 环境下，还会写入作为令牌转存位置的加密文件和密钥。

人格与记忆的内容可以在智能体设置的“人格设定”（ペルソナ）和“记忆”（メモリー）中读写（只有人格的正文 SOUL.md 要在开发者模式的标签页或外部编辑器中编辑）。文件列表请参阅[设置文件](/zh/docs/config/files)。

## 命令

```bash
notemaid                     # 省略子命令时等同于 run
notemaid run                 # 在前台运行（Linux 的默认是文件保管的令牌。要使用与应用相同的钥匙串，加 --secrets keychain）
notemaid status              # 正在运行的 notemaid 的状态
notemaid mcp                 # 作为 stdio 的 MCP 服务器，转发到正在运行的 NoteDeck（与 AI 一起使用 → MCP）
notemaid service install     # 准备登录时任务（不启动）
notemaid service enable      # 注册并启动
notemaid service start | status | stop | restart | uninstall
```
