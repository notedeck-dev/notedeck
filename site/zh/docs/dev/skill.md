---
sourceHash: e53405b52499
---

# 技能

技能是决定 AI 行为方式的 Markdown 指示书。写下它的角色和语气、看哪些数据以及怎么看、用什么格式回答，AI 每次都会照做。

技能是给 AI **读**的东西，与 AI **能执行**的功能是两回事。能执行的功能（应用主题、添加列之类的操作）称为 capability，只有在[权限设置](/zh/docs/guide/ai#权限)中允许的范围内才能使用。无论技能里写了什么，未被允许的操作都不会执行。

与技能分开，AI 还有[人格与记忆](/zh/docs/guide/ai#人格与记忆)（切换技能也不会改变的核心）。技能能更换的，是叠在其上的语气和角色设定（角色）。

## 最小结构

在 Markdown 文件的开头写 frontmatter，下面写正文。

```markdown
---
id: my-skill
name: 摘要小助手
mode: manual
---

你是 Misskey 客户端 NoteDeck 的操作辅助 AI。
请用简体中文简洁地回答。
```

省略 `id` 时会使用文件名。此外还可以写 `description` / `author` / `version` / `iconUrl`。

## 何时被读取（`mode`）

| mode | 何时传给 AI | 适合的用途 |
|---|---|---|
| `always` | 所有对话中始终传递 | 整个应用的行为准则 |
| `manual` | 在技能列中启用期间 | 切换人格、只在需要时才拿出的专业知识 |
| `trigger` | 输入包含 `triggers` 中的词语时。一旦命中，在该会话期间会一直传递 | 只在特定话题时才需要的知识 |
| `heartbeat` | 每次定期执行时 | 定期查看情况并报告 |

`mode: trigger` 需要在 `triggers` 中列出词语。匹配是不区分大小写的部分匹配。每次对话都让 AI 读取全部内容会增加成本，所以内容越专业，越适合用 `trigger`。`manual` 的启用状态以 frontmatter 的 `active: true` 保存。

## 预留技能

`skills/` 中有 2 个名称和作用固定的技能。不能重命名、删除、更改 mode 或禁用，也不会出现在技能列中。请在智能体设置中编辑。内容实质为空期间不会传给 AI。

- `AGENTS.md` — 规则。始终传递（固定为 `always`）。对应智能体设置的“规则”（ルール）
- `HEARTBEAT.md` — 巡查步骤。每次定期执行时传递（固定为 `heartbeat`）。对应智能体设置 HEARTBEAT 中的“编辑巡查步骤”（巡回の手順を編集）

## 编写原则

**在开头固定角色和语气** — 首先写清楚这是做什么的 AI、该怎样回答。

**写明查看数据的顺序** — 界面上可见的帖子和账户信息每次都会传给 AI。在这些已经足够的情况下还让它通过 capability 重新获取，只会增加无谓的往返。可以这样写：“引用界面上的帖子时，先看已经传给你的内容；只有需要所有账户时才获取列表”。

**严格指定回答格式** — 指示含糊时，往往会得到长篇大论。写上“第一行用 30 个字以内给出结论”“列表最多 5 项”之类的约束会很有效。

**写明失败时的行为** — 预先决定在取不到数据、权限不足、无法理解请求时该怎么回答。

**明确写出 capability 名称** — 如果只写“更换主题”，AI 有时会在没有实际操作的情况下回答“已更换”。请像“用 `themes.list` 获取列表 → 选出名称匹配的 id → 用 `themes.apply` 应用”这样写明步骤和名称。

## 定期执行的技能

`mode: heartbeat` 的技能会在智能体设置中启用了 HEARTBEAT 的期间定期执行（默认禁用）。基本上是在应用运行期间，设为[常驻](/zh/docs/notemaid#设为常驻)后即使退出应用也会继续。从睡眠恢复时也会运行 1 次。

在 frontmatter 的 `cheapCheckCapabilities` 中列出“要盯着什么”（通知列表等只读的廉价 capability），那么在与上次相比没有变化时，就会直接跳过对 AI 的调用。不声明的话，即使没有变化，每次也都会调用 AI 并产生费用。即使持续跳过，每隔一定时间也一定会运行一次。

如果把每次执行必然会变化的东西（当前时间等）作为监视对象，就会一直被判定为有变化，跳过机制也就不起作用了。请从“什么变化时希望它醒来”出发进行选择。

HEARTBEAT 期间的权限与聊天是不同的行（默认只读），还可以设置每天 AI 启动次数的上限。把本地 CLI 用作 AI 的连接上不会运行 HEARTBEAT。

## 敏感信息的处理

传给 AI 的数据中，相当于令牌或密码的项目会被自动移除。

## 制作与发布

可以在 AI 列中提出“做一个能某某的技能”。手动编写时，只需在设置文件夹的 `skills/` 中放一个 Markdown 文件。新建与编辑的入口在[开发者模式](/zh/docs/#开发者模式)下开放。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#スキル)）。

capability 的列表和权限的详情，请参阅仓库中的 [SKILLS.md](https://github.com/notedeck-dev/notedeck/blob/main/SKILLS.md)。
