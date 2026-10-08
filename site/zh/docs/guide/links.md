---
sourceHash: 2d7e9ad8f988
---

# 通过链接打开（notedeck://）

桌面版 NoteDeck 在安装时会向操作系统注册 `notedeck://` 这个 URL。从浏览器、启动器、笔记应用或脚本中打开这种 URL，正在运行的 NoteDeck 就会切换到前台并打开对应的界面。

可以用于启动器的快捷方式、每天早上要打开的列的书签、从外部工具调出发帖窗口等。

## 不会替你发送

`notedeck://` 是任何人都能构造的 URL，也可以嵌入网页里诱导你点击。因此，链接不会触发发帖或向 AI 发送内容。

- 发帖窗口和 AI 列只会在填好正文的状态下打开，发送需要你自己点
- 从商店安装时，会在确认对话框中显示名称和作者（插件还会显示所请求的功能），只有你同意后才会安装。能安装的只有 MisStore 上架的内容
- 指向找不到的配置文件、列或商店内容的链接，什么也不会做

## 应用全局操作

这些操作不需要选择账户。值需要进行 URL 编码（空格为 `%20`，换行为 `%0A`）。

| URL | 会发生什么 |
|---|---|
| `notedeck://compose?text=<正文>&cw=<注释>&visibility=<可见性>` | 打开已填入正文、注释和可见性的发帖窗口。均可省略。可见性为 `public` `home` `followers` `specified` 之一 |
| `notedeck://ai?prompt=<文字>` | 打开 AI 列，并在输入框中填入文字。没有 AI 列时会添加一个 |
| `notedeck://memo/new?text=<正文>` | 创建一条带正文的备忘 |
| `notedeck://profile/<名称>` | 切换 Deck 的[配置文件](/zh/docs/deck/profiles)。名称不匹配时会作为 id 查找 |
| `notedeck://column/<id>` | 激活该列 |
| `notedeck://install-plugin?id=<id>` | 确认后安装 [MisStore](/zh/docs/guide/store) 上的插件 |
| `notedeck://install-theme?id=<id>` | 确认后安装 MisStore 上的主题 |

列的 id 写在设置文件夹 `profiles/` 中的配置文件文件里。

## 打开账户的界面

以 `notedeck://<服务器>/...` 的形式打开该服务器的界面。`<服务器>` 是 `misskey.io` 这样的主机名，并且需要已用该服务器的账户登录。

### 添加列

| URL | 添加的列 |
|---|---|
| `notedeck://<服务器>/timeline/<类型>` | 时间线。类型为 `home` `local` `social` `global`（省略时为 `home`） |
| `notedeck://<服务器>/notifications` | 通知 |
| `notedeck://<服务器>/search?q=<搜索词>` | 服务器搜索 |
| `notedeck://<服务器>/antenna/<id>` | 天线 |
| `notedeck://<服务器>/channel/<id>` | 频道 |
| `notedeck://<服务器>/favorites` | 收藏 |
| `notedeck://<服务器>/mentions` | 提及 |
| `notedeck://<服务器>/direct` | 指定用户 |
| `notedeck://<服务器>/chat` | 聊天 |
| `notedeck://<服务器>/announcements` | 公告 |
| `notedeck://<服务器>/drive` | 网盘 |
| `notedeck://<服务器>/gallery` | 图集 |

### 打开窗口

| URL | 打开的窗口 |
|---|---|
| `notedeck://<服务器>/note/<id>` | 帖子 |
| `notedeck://<服务器>/user/<id>` | 用户 |
| `notedeck://<服务器>/user/<id>/following` | 关注列表 |
| `notedeck://<服务器>/user/<id>/followers` | 关注者列表 |
| `notedeck://<服务器>/list/<id>` | 列表 |
| `notedeck://<服务器>/clip/<id>` | 便签 |
| `notedeck://<服务器>/gallery/<id>` | 图集中的作品 |
| `notedeck://<服务器>/page/<id>` | 页面 |
| `notedeck://<服务器>/play/<id>` | Play |
| `notedeck://<服务器>/instance/<主机名>` | 联合服务器的信息 |

id 是该服务器的内部 id（对于用户，不是 `@name`，而是在 Raw JSON 等中可以看到的 `id`）。

## 如何查找 URL

桌面版的标题栏会显示当前激活的列或窗口的 URL。经常打开的界面，可以从那里复制 URL，登记到书签或启动器中。

打开列的 URL 会再添加一个同类型的列。如果只想跳转到 Deck 中已有的列，请使用 `notedeck://column/<id>`。
