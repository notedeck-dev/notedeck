---
sourceHash: 922a7353e8ee
---

# 设置文件

NoteDeck 的设置全部以文件形式保存在本机。能在 UI 中更改的内容会原样写入文件，也可以用外部编辑器直接编辑。

格式是 **JSON5**。可以写注释，也允许末尾逗号（应用重新保存时注释会消失）。

例外是当前打开的配置文件、小工具的布局，以及插件和小工具用 `Mk:save` 保存的值：这些在应用内部的存储区域而不在文件里。

## 设置在哪里

**文件 → 打开设置文件夹**（ファイル → 設定フォルダを開く）会打开资源管理器 / Finder。这是最可靠的方法。

如果想知道路径，它在操作系统的应用数据区域之下。

| OS | 应用数据文件夹 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/` |
| Linux | `~/.local/share/com.notedeck.desktop/` |

环境变量 `NOTEDECK_APP_DIR` 可以改变应用数据文件夹的位置。同一菜单还能打开日志文件夹、下载文件夹和备份文件夹。

应用数据文件夹按处理方式的不同分成四部分。

| 文件夹 | 是什么 | 携带 / 同步 |
|---|---|---|
| `config/` | **设置。** 列配置、主题、快捷键、插件、AI 的连接目标等 | 可以（[用 Git 或 Dropbox 携带设置](/zh/docs/config/sync)） |
| `data/` | **你的记录。** 备忘、AI 的对话、AI 的人格与记忆 | 包含别人的帖子正文，不建议同步 |
| `state/` | **这台电脑的状态。** 窗口位置、缩放、同意与密钥是否存在、"不再确认"的记忆、编辑历史 | 不要 |
| `cache/` | **可以删除的东西。** 图片、表情、宠物精灵图 | 不要 |

此外，帖子缓存和账号信息 `notecli.db`（SQLite，不要同步）、AI 独立进程的日志 `logs/`、从旧版本更新时的退避 `backups/` 直接位于其下。

::: tip 如果从旧版本更新
以前设置、记录和状态同在一个名为 `notedeck/` 的文件夹里。更新后首次启动时会移到上面的形态，迁移前的内容会在 `backups/pre-layout-<日期时间>/` 留一份副本。
:::

## `config/` 里有什么

| 文件 | 内容 |
|---|---|
| `settings.json5` | 主题选择、模式、屏蔽、缓存设置等简单值的汇总处 |
| `keybinds.json5` | [快捷键](/zh/docs/guide/keyboard)的覆盖 |
| `navbar.json5` | [导航栏](/zh/docs/deck/navbar)的按钮配置 |
| `performance.json5` | 渲染相关的调整值 |
| `postform.json5` | 发帖表单的设置 |
| `ai.json5` | [AI](/zh/docs/guide/ai) 的连接与模型选择、HEARTBEAT 设置 |
| `tasks.json5` | 任务列中执行的任务声明 |
| `permissions.json5` | 允许插件和 AI 进行的操作方针。损坏时会把所有行当作只读来启动 |
| `connections.json` | 到外部服务的连接定义（URL 和认证方式。密钥本体和同意在 `state/` 一侧） |
| `locale.json5` | 显示语言 |
| `custom.css` | [外观的覆盖](/zh/docs/guide/appearance#用-css-细调) |
| `.gitignore` | 给用 Git 管理的人的模板。没有就创建，有则不动 |

也有以文件夹形式保存的。

| 文件夹 | 内容 |
|---|---|
| `profiles/` | 甲板配置文件 (`*.ndprofile.json5`)。列以 `user@host` 指向账号 |
| `themes/` | 主题 (`*.ndtheme.json5`) |
| `plugins/` `widgets/` `queries/` | 代码本体 `*.is` 与元信息 `*.meta.json5` 成对 |
| `skills/` | 技能 (`*.md`)。`AGENTS.md` 和 `HEARTBEAT.md` 为保留名 |
| `snippets/` | 草稿板的代码片段 |

文件名是由显示名生成的 slug（来自商店的则是 storeId），引用通过文件内的 id 进行。若有相同 id 的文件重复，后面的会被跳过，并用提示告知。

::: tip API 密钥不在这里
访问令牌和 AI 的 API 密钥存放在操作系统的钥匙串中（Linux 上没有 Secret Service 的环境会退避到加密文件）。即使把 `config/` 原样交给别人，也不包含密钥。不过它也不是可以公开的内容（[携带时的注意](/zh/docs/config/sync)）。
:::

## `data/` 里有什么

| 文件夹 | 内容 |
|---|---|
| `memos/` | 备忘 (`*.md`)。就是 Markdown 文件，可以作为 Obsidian 的 vault 打开 |
| `sessions/` | AI 的对话。以只有自己能读的权限保存 |
| `notemaid/` | AI 的人格与记忆 |

`notemaid/` 是 `SOUL.md`（人格）/ `USER.md`（关于你记住的事）/ `MEMORY.md`（备忘）三个 Markdown，加上仅首次使用的 `BOOTSTRAP.md`。用外部编辑器直接改写也会从下一次对话起生效（AI 会被告知"在 NoteDeck 之外被修改"）。也可以在代理设置的"人格""记忆"中读写，只有 `SOUL.md` 的正文需要在开发者模式的标签页或外部编辑器中编辑。`config/skills/` 中的 `AGENTS.md`（规则）和 `HEARTBEAT.md`（巡回步骤）名称和职责固定，不能删除或重命名，也不会出现在技能列中（从代理设置编辑）。进入备份的只有三个 Markdown。

## `state/` 里有什么

不需要动它们，删掉也不会丢失设置。

| 文件 | 内容 |
|---|---|
| `ui.json5` | 宠物的位置、缩放、发帖表单上次使用的可见范围 |
| `deck/<配置文件 id>.json5` | 弹出窗口的布局，以及列中输入到一半的内容（搜索词等） |
| `connections-meta.json` | 每个连接的同意（给 AI / 给外部应用看）、是否存有密钥、上次使用时刻 |
| `permissions-meta.json5` | "不再确认"的记忆，以及上次启动时权限的副本（从外部被放宽时启动时会告知） |
| `client.json5` | 仅这台电脑的配置（[AI 独立进程](/zh/docs/notemaid)的连接方式） |
| `tutorial.json5` | 教程的完成记录和成就 |
| `theme-dropins.json5` | 手动放进 `themes/` 的主题的导入记录 |
| `history/` | 设置文件编辑前的内容（历史窗口读取） |
| `notemaid/` `secrets/` | AI 独立进程的工作状态，以及外部应用用令牌的记录 |

## 在应用中编辑

不用外部编辑器，也可以从设置编辑器窗口编辑。在[开发者模式](/zh/docs/#开发者模式)下，还会出现直接编辑 `settings.json5` 等原始内容的标签页。

更改基本上**无需重启即可生效**。用外部编辑器改写时，请在应用关闭期间进行。应用不会监视外部变化，开着应用改动的话，下一次操作时应用这边的副本会覆盖掉。

## 写错的时候

作为 JSON5 已损坏的文件会读取失败。此时该文件的设置以默认值运行（只有 `permissions.json5` 倒向安全一侧，所有行变为只读）。觉得不对劲时，请把相关文件删除一次（会以默认值重新创建）。
