---
sourceHash: 64744d8b9f75
---

# 插件

插件是用 AiScript 编写的扩展。它可以为帖子和用户添加操作、改写要发布的内容，或在命令面板中添加命令。思路与 Misskey 本身的插件相同，但增加了 NoteDeck 独有的 API。

## 最小结构

在开头写上 AiScript 的版本和元数据头。版本那一行是必需的，没有它插件不会启动，日志中会出现 `version header required`。执行始终使用较新的解释器。

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

元数据中必填的只有 `name` 和 `version`。写上 `config` 后，其值可以通过 `Plugin:config` 读取。

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

命令面板中的命令不是通过钩子，而是通过后文所述的 `Nd:register_command` 添加。

::: warning interruptor 是同步执行的
`*_interruptor` 是同步调用的，因此无法在其中弹出确认对话框。用于把关发帖时，请采用不经确认、自动处理的方式（自动添加 CW、降低可见性）。
:::

## NoteDeck 独有 API

| API | 做什么 |
|---|---|
| `Nd:version` | 应用的版本 |
| `Nd:call(id, params)` | 调用 capability。只在权限范围内才会成功。如果确认对话框被取消，不会报错，而是返回 `Core:type` 为 `"error"` 的值 |
| `Nd:capabilities()` | 可调用的 capability 列表 |
| `Nd:http(url, options)` | 向外部发送 HTTP 请求。返回 `{ status, headers, body }`。通信中断（域名解析失败、连接被拒绝、超时）也不会报错，而是 `status` 为 `0`，原因放在 `error` 中 |
| `Nd:on(event, handler)` | 订阅应用内的事件 |
| `Nd:register_command(...)` | 向命令面板添加命令 |
| `Plugin:open_url(url)` | 在默认浏览器中打开 URL |

可以用 `Nd:on` 订阅的事件包括：帖子到达、通知到达、列的增减、流式连接状态、备忘的创建/更新/删除、技能的编辑以及主题的应用。

处理函数在应用进程中只会被调用一次（即使打开了多个窗口，事件也只会送达一个代表窗口）。帖子的显示钩子会在每个窗口中被调用，所以不要在钩子里写副作用。

用 `Nd:register_command` 添加的命令，可以从命令面板、键位绑定、AI 的工具、本地 API 中的任何地方调用。被 AI 或本地 API 调用时的实际权限是“调用方的权限 ∩ 插件的权限”。

## 调用失败时

AiScript 没有 try / catch。API 调用失败时，那一段处理（handler）会在那里停下。插件本身不会停止，之后的操作和事件仍然有效。

停下之后，用户会以下面的方式看到。

- 由帖子、用户、发帖表单的操作开始的处理：错误的第一行显示在提示中
- 小工具：错误显示在小工具的框内，下次重新绘制画面后消失
- 由命令面板的命令、事件或定时器开始的处理：只记录在运行日志中

| API | 失败时 |
|---|---|
| `Nd:http` | 不会停下。通信的结果（4xx / 5xx、连接失败）以值返回 |
| `Mk:api` | 停下 |
| `Nd:call` | 停下。只有确认对话框被取消时不会停下，而是返回 error 值 |

没有权限时，任何 API 都会停下。

`Nd:call` 返回的 error 值的种类今后可能增加。是否为取消，请按名称判断。

```
let res = Nd:call("notes.create", { text: "hello" })
if Core:type(res) == "error" && res.name == "user_cancelled" {
  // 已取消
}
```

Misskey 本身的 `Mk:api` 在失败时不会停下，而是返回 error 值（`request_failed`）。如果插件要在两边运行，请保留 `Core:type(res) == "error"` 的分支。NoteDeck 的 `Mk:api` 也计划改为与 Misskey 相同的返回方式。

## Misskey 兼容 API

可以使用 `Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize`。如果要直接引入 Misskey 本身的插件，请确认它是否只使用了这些 API。`Mk:save` 的值不是文件，而是存放在应用内的保存区域中，不包含在[备份](/zh/docs/config/backup)里。

## 权限

插件能做什么，由[权限设置](/zh/docs/guide/ai#权限)中“插件”那一行决定。默认是以读取为主的安全范围加上对外通信，发帖等写入操作需要逐项允许。`Nd:call` / `Nd:http` / `Mk:api` 都按这个设置判定，被拒绝的操作会作为拒绝徽标显示在插件列中。写入技能、相当于向 AI 下指示的操作，无论设置如何都始终被拒绝。

元数据头中的 `permissions` 是在从商店更新时用于显示“新请求的权限”并重新取得同意的声明。

### 连接到本机的端口

`Nd:http` 默认拒绝连接到本机 (`localhost` / `127.0.0.1` / `[::1]`)。如果想调用在本机运行的进程 (比如自己写的翻译服务器、本地数据库的查询接口)，请在元数据头的 `loopback` 中声明端口。

```is
### {
  name: "本地翻译"
  version: "1.0.0"
  loopback: [8080]
}
```

第一次向声明的端口发出请求时，会询问用户是否允许这个插件连接该端口 (只在用户从帖子或用户菜单、发帖表单、命令面板触发的操作内询问；启动时的代码、`Nd:on` 事件和定时器不会询问而直接拒绝，可以在插件详情的设置中允许)。许可与插件正文绑定，正文因商店更新或编辑而变化后，下一次请求会再次询问。许可之后，每次请求的确认与以前相同。

插件在代表 AI、其他插件或外部应用运行时，即使有许可也无法连接本机端口。小部件 / Play / 页面没有写声明的地方，因此不在范围内。NoteDeck 自身的端口无论是否声明、是否许可都无法连接。响应是一次往返的字符串，和他人的帖子一样被视为不可信内容。

## 保存位置

保存在设置文件夹的 `plugins/` 中，由代码本体 `<slug>.is` 和元信息 `<slug>.meta.json5` 两个文件组成。列表由元文件生成，所以只放 `.is` 不会被读取。手动放置时，最可靠的做法是先在开发者模式的编辑器中新建，再替换其内容。文件名是由显示名生成的 slug（来自商店的则为 storeId），引用通过文件内的 id 进行。相同的 id 重复时，后面的会被跳过，并以 toast 通知你。

## 制作与发布

最快的方法是在 AI 列中提出“做一个能某某的插件”（需要先安装 MisStore 的作者技能）。创建与编辑的入口在[开发者模式](/zh/docs/#开发者模式)下开放。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)）。
