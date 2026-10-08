---
sourceHash: f6d58ea6d289
---

# 设置文件

NoteDeck 的所有设置都以文件形式保存在本地。在 UI 中能修改的内容，也会原样写入文件。用外部编辑器直接编辑也没有问题。

格式为 **JSON5**。可以写注释，也允许末尾逗号。

## 设置在哪里

通过 **文件 → 打开设置文件夹**（ファイル → 設定フォルダを開く）会打开资源管理器 / 访达。这是最可靠的方法。

如果想知道路径，它位于操作系统的应用数据目录下。

| 操作系统 | 位置 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

在同一个菜单中，还可以打开日志文件夹、下载文件夹和备份文件夹。

## 什么写在哪里

| 文件 | 内容 |
|---|---|
| `settings.json5` | 主题选择、模式、屏蔽、缓存设置等简单值的汇总处 |
| `keybinds.json5` | 覆盖[快捷键](/zh/docs/guide/keyboard)的设置 |
| `navbar.json5` | [导航栏](/zh/docs/deck/navbar)的按钮配置 |
| `performance.json5` | 渲染相关的调整值 |
| `postform.json5` | 发帖窗口的设置 |
| `ai.json5` | [AI](/zh/docs/guide/ai) 的连接与模型选择 |
| `AI.md` | 传给 AI 的指示书 |
| `tasks.json5` | 任务列的内容 |
| `permissions.json5` | 允许插件和 AI 执行的操作 |
| `custom.css` | [覆盖外观](/zh/docs/guide/appearance#用-css-精细调整) |

也有一些以文件夹形式保存。

`profiles/` `themes/` `plugins/` `widgets/` `skills/` `queries/` `snippets/` `memos/` `sessions/` `notemaid/`

`memos/` 中直接存放的是 Markdown 文件，因此可以作为 Obsidian 的 vault 打开。

`notemaid/` 是 AI 的人格与记忆：`SOUL.md`（人格）/ `USER.md`（关于你的记忆）/ `MEMORY.md`（笔记）这 3 个 Markdown 文件，以及仅在首次使用的 `BOOTSTRAP.md`。用外部编辑器直接改写后，从下一次对话起生效（AI 会被告知“在 NoteDeck 之外被修改过”）。`skills/` 中的 `AGENTS.md`（规则）和 `HEARTBEAT.md`（巡查步骤）名称和作用都是固定的，不能删除或重命名。只有那 3 个 Markdown 文件会被纳入备份。

::: tip API 密钥不在这里
访问令牌和 AI 的 API 密钥保存在操作系统的钥匙串中。即使把设置文件夹原样交给别人，里面也不包含密钥。
:::

## 在应用内编辑

即使不使用外部编辑器，也可以在设置编辑器窗口中编辑。`settings.json5` 还可以在 Raw JSON 编辑器中直接修改。

修改基本上**无需重启即可生效**。用外部编辑器改写的文件，也会在下次使用时重新读取。

## 写错了怎么办

作为 JSON5 已损坏的文件会加载失败。此时，该文件中的设置会以默认值运行。如果觉得不对劲，请先删除对应的文件（会以默认值重新生成）。
