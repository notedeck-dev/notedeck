---
sourceHash: 351a0242008d
---

# 插件

插件是用 AiScript 编写的扩展。它可以为帖子和用户添加操作、改写要发布的内容，或在命令面板中添加命令。思路与 Misskey 本身的插件相同，但增加了 NoteDeck 独有的 API。

## 最小结构

在开头写上元数据头。如果省略 AiScript 的版本声明，文件会被旧的解析器解析，无法使用后文所述的 interruptor。

```is
/// @ 1.2.1
### {
  name: "示例"
  version: "1.0.0"
  author: "你"
  description: "这个插件做什么"
  permissions: []
}
```

## 可以注册的钩子

用 `Plugin:register_*` 注册钩子。插件在加载时执行一次，在那里注册的函数之后会在每次事件发生时被调用。

| 钩子 | 调用时机 |
|---|---|
| `register_note_action` | 从帖子菜单中选择时 |
| `register_user_action` | 从用户菜单中选择时 |
| `register_post_form_action` | 按下发帖窗口中的按钮时 |
| `register_note_view_interruptor` | 即将显示帖子之前 |
| `register_note_post_interruptor` | 即将发布帖子之前 |
| `register_page_view_interruptor` | 即将显示页面之前 |
| `register_command` | 作为命令被调用时 |

::: warning interruptor 是同步执行的
`*_interruptor` 是同步调用的，因此无法在其中弹出确认对话框。用于把关发帖时，请采用不经确认、自动处理的方式（自动添加 CW、降低可见性）。
:::

## NoteDeck 独有 API

| API | 做什么 |
|---|---|
| `Nd:version` | 应用的版本 |
| `Nd:call(id, params)` | 调用 capability。只在权限范围内才会成功。如果确认对话框被取消，不会报错，而是返回 `Core:type` 为 `"error"` 的值 |
| `Nd:capabilities()` | 可调用的 capability 列表 |
| `Nd:http(url, options)` | 向外部发送 HTTP 请求 |
| `Nd:on(event, handler)` | 订阅应用内的事件 |
| `Nd:register_command(...)` | 向命令面板添加命令 |

可以用 `Nd:on` 订阅的事件包括：帖子到达、通知到达、切换账户、列的增减、流式连接状态、备忘的创建/更新/删除、技能的编辑以及主题的应用。

## Misskey 兼容 API

可以使用 `Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize`。如果要直接引入 Misskey 本身的插件，请确认它是否只使用了这些 API。

## 权限

对外通信、发布帖子等有影响的操作需要权限。在元数据头的 `permissions` 中声明，安装时由用户批准。未声明的操作会在运行时被拒绝。

## 制作与发布

最快的方法是在 AI 列中提出“做一个能某某的插件”。手动编写时，请放在设置文件夹中。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)）。
