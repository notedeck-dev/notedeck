---
sourceHash: 7949c17317a2
---

# 从其他应用使用（Raycast / Stream Deck / Obsidian）

桌面版 NoteDeck 在运行期间始终在本机开放 HTTP API（`127.0.0.1:19820`），并在安装时向操作系统注册 `notedeck://` 链接。借助这两个入口，其他应用可以操作 NoteDeck。

官方集成有 3 个，它们都不向 NoteDeck 本体添加任何东西，各自放在独立的仓库里发布。你也可以基于同一套 API 自己编写。

| 集成 | 适合的用途 | 仓库 |
|---|---|---|
| Raycast 扩展 | 从启动器发帖、搜索、跳转到列 | [notedeck-raycast](https://github.com/notedeck-dev/notedeck-raycast) |
| Stream Deck 插件 | 用实体按键发帖、切换列、老板键 | [notedeck-streamdeck](https://github.com/notedeck-dev/notedeck-streamdeck) |
| Obsidian 插件 | 把帖子收进 vault、从 Obsidian 发帖、侧边栏时间线 | [notedeck-obsidian](https://github.com/notedeck-dev/notedeck-obsidian) |

::: warning 尚未上架商店
这 3 个都还没有登上 Raycast Store / Stream Deck Marketplace / Obsidian 社区插件。请按各仓库 README 中的步骤自行构建安装。实机验证也还不充分，遇到不能用的情况请通过 issue 告诉我们。
:::

## 共同的机制

3 个集成使用相同的两个入口。记住其中一个的设置方法，其余的也一样。

**需要令牌的操作** — 调用 NoteDeck API 的操作（发帖、搜索、账号列表、获取时间线等）需要持久 API 令牌。

1. 在 设置 → 权限 → 「持久 API 令牌」签发令牌，粘贴到集成的设置里
2. 为每个集成分别签发令牌并命名（如 `raycast` `streamdeck` `obsidian`），确认对话框和操作记录里会显示这个名字，可以分辨是哪个集成做的
3. 签发时选择该令牌可以做的操作。默认只读，发帖等写入需要逐项允许。上限是同一界面里「外部应用」的权限，实际生效的是两者的交集
4. 发帖等写入一定会先在 NoteDeck 的界面上确认再执行。集成一侧会等到你在 NoteDeck 里作答

**不需要令牌的操作** — 打开发帖表单、切换配置文件、把列提到前面等界面操作通过 `notedeck://` 链接完成。不需要令牌、权限和确认，因为打开链接的是你自己。链接能做什么见[通过链接打开](/zh/docs/guide/links)。

::: tip 这不是安全边界
令牌的权限是为了防止守规矩的集成出事故，以及分辨谁做了什么。以同一操作系统用户运行的程序能够到 NoteDeck 本体所能到的一切。详见[与 AI 一起使用](/zh/docs/guide/ai#从外部-ai-智能体使用-mcp)中的同一条注意。
:::

所有集成都只在 NoteDeck 于同一台机器上运行时才能工作。开发版 NoteDeck（`pnpm tauri:dev`）的 API 端口不同，需要在集成的设置里修改 API URL。

## Raycast

把 NoteDeck 作为 Raycast（macOS / Windows）的命令来调用。

| 命令 | 做什么 | 需要 |
|---|---|---|
| Post Note | 填写正文、账号、可见范围、CW 后发帖。也可以用 ⌘O 交给 NoteDeck 的发帖表单 | 令牌 + `notes.write` |
| Open Post Form | 打开 NoteDeck 的发帖表单并填入正文 | 无 |
| Search My Notes | 搜索本机积累的自己的帖子和备忘。留空显示最近的。Enter 在 NoteDeck 中打开 | 令牌 + `notes.readArchive` 与 `memos.read` |
| Jump to Column | 选择 deck 中的列并提到前面 | 令牌（默认的只读即可） |
| Switch Deck Profile | 按名称切换[配置文件](/zh/docs/deck/profiles) | 无 |
| Ask AI | 打开 AI 列并填入提示词。发送由你自己按下 | 无 |
| New Memo | 新建一条本地备忘 | 令牌 + `memos.write` |
| Hide NoteDeck / Show NoteDeck | 隐藏窗口 / 恢复到前台（老板键） | 令牌（不需要权限） |
| Run Capability | 从列表中选择 NoteDeck 的任意 capability（命令面板、插件、AI 能用的全部），填入参数后执行。结果以 JSON 显示 | 令牌 + 该 capability 所需的权限 |

Run Capability 也适合用来查其他集成要用的账号 id 和列 id。

## Stream Deck

把 NoteDeck 的动作分配到 Stream Deck 的按键上。API URL 和令牌在第一个按键里填一次，其他按键共用。

| 动作 | 做什么 | 需要 |
|---|---|---|
| Post Note | 发送预先设定的正文（含账号、CW、可见范围） | 令牌 + `notes.write` |
| Open Post Form | 打开 NoteDeck 的发帖表单并填入设定的正文 | 无 |
| Run Capability | 预先设定 capability 的 id 和 JSON 参数，用按键执行 | 令牌 + 该 capability 所需的权限 |
| Focus Column | 把设定的列提到前面 | 无 |
| Switch Deck Profile | 切换到设定的配置文件 | 无 |
| Hide NoteDeck / Show NoteDeck | 隐藏窗口 / 恢复到前台（老板键） | 令牌（不需要权限） |

成功时按键显示 ✓，失败时显示 ⚠。原因在插件的日志里。

## Obsidian

在 Obsidian（桌面版）中把 Misskey 的帖子收进 vault、从 Obsidian 发帖、在侧边栏看时间线。

| 命令 / 界面 | 做什么 | 需要 |
|---|---|---|
| Clip a note by URL | 输入帖子的 URL，把该帖子作为带 YAML frontmatter 的 Markdown 写入 vault | 令牌（默认的只读即可） |
| Search NoteDeck's archive and clip | 跨服务器和账号搜索本机积累的帖子，Enter 收进 vault，Mod+Enter 在光标处插入链接 | 令牌 + `notes.readArchive` |
| Post a note | 以选中的文本为正文发帖（可选账号、可见范围、CW） | 令牌 + `notes.write` |
| Open NoteDeck's post form with selection | 把选中的文本交给 NoteDeck 的发帖表单 | 无 |
| 时间线（侧边栏） | 选择账号，显示 home / local / social / global。新帖子来自 NoteDeck 的事件流。点击帖子可收进 vault、在 NoteDeck 中打开、在服务器上打开、复制链接 | 令牌（默认的只读即可） |

收进来的帖子放在设置中指定的文件夹（默认 `NoteDeck/`），文件名为「日期 时间 用户名 id.md」。再次收取同一帖子时不会覆盖，而是打开已有文件。frontmatter 包含作者、URL、日期、可见范围、CW、引用来源；正文保持 MFM 原样，CW 变成折叠的 callout，图片嵌入，敏感图片和其他文件变成链接。

::: tip 备忘不经插件就能直接打开
NoteDeck 的[备忘](/zh/docs/deck/columns)以 Markdown 文件的形式放在设置文件夹的 `memos/` 里。把该文件夹作为 Obsidian 的 vault 打开，无需插件即可读写。本插件不会碰备忘。
:::

Clip a note by URL 只接受你在 NoteDeck 中登录过的服务器上的帖子 URL（因为要用该账号去取帖子）。其他服务器的帖子请从搜索收取。

## 自己编写

3 个集成做的事只有两件：向 `127.0.0.1:19820` 发送带 Bearer 令牌的 HTTP 请求，以及打开 `notedeck://` 链接。任何语言都能做到同样的事。

- API 一览在[开发者模式](/zh/docs/#开发者模式)的「API 文档」列中查看。capability 通过 `POST /api/capabilities/<id>/execute` 调用，`GET /api/capabilities` 列出全部 capability 及其参数和权限的声明
- 要即时接收新帖子和通知，订阅 `GET /api/events` 的 Server-Sent Events
- 如果调用方是 AI 智能体，用同一个令牌连接 [MCP](/zh/docs/guide/ai#从外部-ai-智能体使用-mcp) 更快

做好了集成，请通过 issue 告诉我们，会在本页列出。
