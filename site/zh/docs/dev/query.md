---
sourceHash: 2d775546f9f4
---

# 列查询

列查询是用于筛选流入列中帖子的表达式。它用 AiScript 的子集编写，**返回 true 的帖子会被显示**。要写“隐藏某某”时，先写出条件，再用 `!(...)` 把整体包起来。

```is
/// @ 1.2.1
// 隐藏包含特定关键词的帖子 — true = 显示
!(note.text != null && note.text.lower().incl("剧透"))
```

查询的定义、编辑和从商店安装在“查询”列中进行，应用到哪些列则在各列的筛选菜单中用开关切换。除了时间线，也可以应用到[客户端搜索](/zh/docs/guide/search#客户端搜索列)的结果上。多个查询会以 And 组合，因此让每个查询只承担一个功能会更便于管理。

## 可以引用的内容

表达式中可以自由引用的只有 `note`。以下字段可以快速求值，也可用于搜索存在本地的帖子。

```
note.text  note.cw  note.visibility  note.localOnly
note.renoteId  note.replyId
note.user.username  note.user.host  note.user.name
note.files.len  note.reactions["表情符号名"]
```

可以使用比较和逻辑运算、字符串的 `incl` / `starts_with` / `ends_with` / `lower` / `upper`、数组的 `incl` / `len`、`let`，以及不递归的纯函数。

超出这个范围的字段（`note.user.isCat`、`note.channelId`、`note.renote.text`、`note.poll` 等）也能使用，但会退回到逐条求值的慢速路径。结果不变，只是速度不同。走的是哪条路径，可以从查询列中的 ⚡ / 🐢 徽标看出（⚠ 表示有无法解释的部分）。

## 编写时的注意事项

- **用 `&&` 的短路求值避开 null** — `note.text` / `note.cw` / `note.user.name` 可能为 null。请写成 `note.text != null && note.text.incl("x")` 的形式。`let` 会先被求值，所以起不到保护作用
- **不要在二元运算符之后换行** — 表达式请写在一行内，或者拆分成函数
- **无法与外部通信** — `Mk:api`、获取当前时间以及异步处理会在保存时被拒绝
- **没有专门的话题标签字段** — 请用正文的字符串匹配代替。注意前缀匹配可能会命中你不想要的标签
- **不要重复制作列设置中已有的功能** — 排除转发、排除回复、仅媒体等已作为开关提供在列的筛选菜单中（显示哪些开关取决于时间线的类型和服务器）

## 不再工作时

- 禁用查询本体后，正在应用它的列会把它当作“不存在”处理
- 求值耗时过长的查询会自动停止。可以在查询列中“恢复”
- 引用目标消失、无法解释等情况下，会倒向不显示该帖子的一侧。安全模式期间会停止查询本身，全部显示
- 编辑会留下历史记录，可以回退到之前的版本

## 保存位置

保存在设置文件夹的 `queries/` 中，由表达式 `<slug>.is` 和元信息 `<slug>.meta.json5` 两个文件组成。与其他分发物一样，按所有账户共用和按账户的池来管理。

## 安装与发布

从[商店](/zh/docs/guide/store)安装的查询可以直接使用，也可以编辑后改成自己用的版本。仅安装不会应用到任何列，请在要使用的列的筛选菜单中启用。商店侧更新后，会附带差异通知你。新建与编辑的入口在[开发者模式](/zh/docs/#开发者模式)下开放。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#クエリ)）。
