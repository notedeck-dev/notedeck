---
sourceHash: 24e5a61f3727
---

# 设置文件

NoteDeck 的所有设置都以文件形式保存在本地。在 UI 中能修改的内容，也会原样写入文件。用外部编辑器直接编辑也没有问题。

格式为 **JSON5**。可以写注释，也允许末尾逗号。

例外是：当前打开的配置文件、小工具的布局、插件和小工具用 `Mk:save` 保存的值，这些不是文件，而是存放在应用内的保存区域中。

## 设置在哪里

通过 **文件 → 打开设置文件夹**（ファイル → 設定フォルダを開く）会打开资源管理器 / 访达。这是最可靠的方法。

如果想知道路径，它位于操作系统的应用数据目录下。

| 操作系统 | 位置 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

上一级的 `com.notedeck.desktop/` 是应用数据文件夹，帖子缓存 `notecli.db`、日志，以及 AI 的独立进程从应用复制过来的账户列表（`notemaid-accounts.json`）都在那里。可以用环境变量 `NOTEDECK_APP_DIR` 更改应用数据文件夹的位置。

在同一个菜单中，还可以打开日志文件夹、下载文件夹和备份文件夹。

## 什么写在哪里

| 文件 | 内容 |
|---|---|
| `settings.json5` | 主题选择、模式、屏蔽、缓存设置等简单值的汇总处 |
| `keybinds.json5` | 覆盖[快捷键](/zh/docs/guide/keyboard)的设置 |
| `navbar.json5` | [导航栏](/zh/docs/deck/navbar)的按钮配置 |
| `performance.json5` | 渲染相关的调整值 |
| `postform.json5` | 发帖窗口的设置 |
| `ai.json5` | [AI](/zh/docs/guide/ai) 的连接与模型选择、HEARTBEAT 的设置 |
| `tasks.json5` | 任务列中要执行的任务的声明 |
| `permissions.json5` | 允许插件和 AI 执行的操作。损坏时会把所有行当作只读来启动 |
| `locale.json5` | 显示语言 |
| `tutorial.json5` | 教程的完成记录和成就 |
| `custom.css` | [覆盖外观](/zh/docs/guide/appearance#用-css-精细调整)（历史记录在 `custom.css.history.json5`） |
| `theme-dropins.json5` | 手动放入 `themes/` 的主题的导入记录 |
| `client.json5` | 仅这台设备的配置（[AI 的独立进程](/zh/docs/notemaid)的连接方式等）。不纳入备份 |

也有一些以文件夹形式保存。

| 文件夹 | 内容 |
|---|---|
| `profiles/` | Deck 的配置文件（`*.ndprofile.json5`） |
| `themes/` | 主题（`*.ndtheme.json5`） |
| `plugins/` `widgets/` `queries/` | 代码本体 `*.is` 和元信息 `*.meta.json5` 的组合 |
| `skills/` | 技能（`*.md`）。`AGENTS.md` 和 `HEARTBEAT.md` 为预留 |
| `snippets/` | 草稿板的代码片段 |
| `memos/` | 备忘（`*.md`） |
| `sessions/` | AI 的对话。以只有自己可读的权限保存 |
| `notemaid/` | AI 的人格与记忆 |

文件名是由显示名生成的 slug（来自商店的则为 storeId），引用通过文件内的 id 进行。拥有相同 id 的文件重复时，后面的会被跳过，并以 toast 通知你。

`memos/` 中直接存放的是 Markdown 文件，因此可以作为 Obsidian 的 vault 打开。

`notemaid/` 是 AI 的人格与记忆：`SOUL.md`（人格）/ `USER.md`（关于你的记忆）/ `MEMORY.md`（笔记）这 3 个 Markdown 文件，以及仅在首次使用的 `BOOTSTRAP.md`。用外部编辑器直接改写后，从下一次对话起生效（AI 会被告知“在 NoteDeck 之外被修改过”）。也可以在智能体设置的“人格设定”（ペルソナ）“记忆”（メモリー）中读写，只有 `SOUL.md` 的正文要在开发者模式的标签页或外部编辑器中编辑。`skills/` 中的 `AGENTS.md`（规则）和 `HEARTBEAT.md`（巡查步骤）名称和作用都是固定的，不能删除或重命名，也不会出现在技能列中（在智能体设置中编辑）。只有那 3 个 Markdown 文件会被纳入备份。

::: tip API 密钥不在这里
访问令牌和 AI 的 API 密钥保存在操作系统的钥匙串中（在没有 Secret Service 的 Linux 环境下会转存到加密文件）。即使把设置文件夹原样交给别人，里面也不包含密钥。
:::

## 在应用内编辑

即使不使用外部编辑器，也可以在设置编辑器窗口中编辑。在[开发者模式](/zh/docs/#开发者模式)下，还会出现直接编辑 `settings.json5` 等文件原文的标签页。

修改基本上**无需重启即可生效**。用外部编辑器改写的文件，也会在下次使用时重新读取。

## 写错了怎么办

作为 JSON5 已损坏的文件会加载失败。此时，该文件中的设置会以默认值运行（只有 `permissions.json5` 会倒向安全一侧，所有行都变为只读）。如果觉得不对劲，请先删除对应的文件（会以默认值重新生成）。
