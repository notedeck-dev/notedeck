---
sourceHash: c6c7b7b84e50
---

# 小工具

小工具是用于在界面上放置小型 UI 的扩展。用 AiScript 编写，可用于时钟、统计、显示从外部获取的数据等。与插件不同，它没有钩子，结构很简单：运行时只负责绘制。

## 最小结构

在顶层调用 `Ui:render`。插件那样的元数据头不会被解释。名称和自动运行的设置由放在旁边的元文件（见后文）持有。

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

UI 通过排列 `Ui:C:*` 组件来构建。可以使用文本、按钮、输入框等。

## 保存状态

用 `Mk:save` 和 `Mk:load` 可以保存值。即使重新绘制或重启应用，这些值也会保留。保存区域按“小工具 × 执行它的账户”划分，所以同一个小工具换账户放置时，值也不会混在一起。这些值不是文件，而是存放在应用内的保存区域中，不包含在[备份](/zh/docs/config/backup)里。

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

小工具默认需要手动启动。打开列时不会自动运行，按下“运行”（実行）时才会执行。也可以打开“自动运行”（自動実行），但请注意：对于与外部通信的小工具，只要打开就会产生网络请求。随时都可以切换回来。

用哪个账户运行，由放到小工具列时的配置决定。小工具能做的事情范围，与[权限设置](/zh/docs/guide/ai#权限)中“插件”那一行的规则相同。

## 保存位置

保存在设置文件夹的 `widgets/` 中，由代码本体 `<slug>.is` 和元信息 `<slug>.meta.json5`（名称、自动运行、是否为所有账户共用、安装到了哪些账户、创建 / 更新时间）两个文件组成。列表由元文件生成。

## 制作与发布

可以在 AI 列中提出“做一个显示某某的小工具”（需要先安装 MisStore 的作者技能）。创建与编辑的入口在[开发者模式](/zh/docs/#开发者模式)下开放。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)）。
