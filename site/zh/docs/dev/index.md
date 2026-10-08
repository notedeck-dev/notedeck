---
sourceHash: e642e3e818c4
---

# 制作扩展

NoteDeck 不只能使用已有的功能，还可以自己添加功能。可以添加的东西共有 5 种，各自的作用和编写语言都不同。

| 类型 | 做什么 | 用什么写 |
|---|---|---|
| [插件](/zh/docs/dev/plugin) | 为帖子和用户添加操作。改写帖子、添加命令 | AiScript |
| [小工具](/zh/docs/dev/widget) | 放置小型 UI。时钟、统计、显示外部数据 | AiScript |
| [主题](/zh/docs/dev/theme) | 更改配色 | JSON5 |
| [列查询](/zh/docs/dev/query) | 筛选和排序流入列中的帖子 | AiScript 的子集 |
| [技能](/zh/docs/dev/skill) | 决定 AI 的行为方式 | Markdown |

拿不准时，就按“想改变什么”来选。**外观**用主题，**流入的内容**用列查询，**操作**用插件，**放在界面上的东西**用小工具，**AI 的回应**用技能。

## 三种制作方式

**让 AI 来做** — 最快的方法。在 AI 列中提出“做一个能某某的插件”，作者技能（在 MisStore 上发布）就会启动，编写 AiScript，验证后保存。即使不懂写法，也能得到能运行的东西。

**手动编写** — 通过“文件 → 打开设置文件夹”（ファイル → 設定フォルダを開く）打开设置文件夹，用文本编辑器直接编写。也可以在应用内的编辑器中编辑。

**从商店安装后改造** — 从[商店](/zh/docs/guide/store)安装的内容可以直接编辑。以已经能运行的东西为起点，比从零开始写更可靠。

## 存放在哪里

所有扩展都是设置文件夹中的文件。它们与账户信息分开保存，并且属于[备份](/zh/docs/config/backup)的对象。文件的位置和作用请参阅[设置文件](/zh/docs/config/files)。

## 发布

制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布。提交步骤和收录标准请参阅 MisStore 的文档（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式参考](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md)）。主题并不是 NoteDeck 特有的格式，因此也可以原样分享给普通的 Misskey 使用。
