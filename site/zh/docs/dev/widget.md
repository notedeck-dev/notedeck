---
sourceHash: 6d4fe29094a3
---

# 小工具

小工具是用于在界面上放置小型 UI 的扩展。用 AiScript 编写，可用于时钟、统计、显示从外部获取的数据等。与插件不同，它没有钩子，结构很简单：运行时只负责绘制。

## 最小结构

在顶层调用 `Ui:render`。与插件不同，元数据头不是必需的，但写上会更便于管理。

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

UI 通过排列 `Ui:C:*` 组件来构建。可以使用文本、按钮、输入框等。

## 保存状态

用 `Mk:save` 和 `Mk:load` 可以在每个小工具专属的区域中保存值。即使重新绘制或重启应用，这些值也会保留。

```is
/// @ 1.2.1
var count = (Mk:load("count") or 0)

Ui:render([
  Ui:C:text({ text: `Count: {count}` })
  Ui:C:button({
    text: "+1"
    onClick: @() {
      count += 1
      Mk:save("count", count)
    }
  })
])
```

## 自动运行

小工具默认需要手动启动。打开列时不会自动运行，按下“启动”（起動）时才会执行。也可以切换为自动运行，但请注意：对于与外部通信的小工具，只要打开就会产生网络请求。随时都可以切换回来。

## 制作与发布

可以在 AI 列中提出“做一个显示某某的小工具”。手动编写时，请在设置文件夹中放置代码本体和元信息两个文件。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)）。
