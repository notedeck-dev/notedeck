---
sourceHash: 645fa56e8076
---

# 主题

主题是配色的定义。它与 Misskey 本身使用相同的格式，因此在 NoteDeck 中制作的主题也可以原样分享给普通的 Misskey 使用。

如果想改变的不是配色，而是布局或元素的显示/隐藏，请使用[更改外观](/zh/docs/guide/appearance)中的自定义 CSS。

## 结构

用 JSON5 编写。可以省略键的引号，可以使用末尾逗号和注释。

```json5
{
  id: '679b3b87-a4e9-4789-8696-b56c15cc33b0',  // 必填。惯例使用 UUID
  name: '主题名称',                              // 必填
  base: 'dark',                                 // 'light' 或 'dark'
  desc: '一句话说明',                            // 可选
  author: '@user@host',                         // 可选
  props: { /* 颜色定义 */ },
}
```

`props` 中没有写的键，会使用 `base` 指定的标准主题的值。不需要全部写出，只写想改的部分就能工作。

`id` 是覆盖时使用的键。用相同的 `id` 重新安装会替换已有的主题，因此新主题请务必分配新的 `id`。

## 值的写法

**字面颜色** — `'#f00'` `'#ff0000'` `'#ff000080'`（8 位表示带透明度）`'rgb(255, 0, 0)'` `'rgba(255, 0, 0, 0.5)'`

**引用** — 像 `'@accent'` 这样，使用同一主题中的其他值。即使被引用的值本身又是引用或函数，也会被解析。引用不存在的名称会得到空值，那个颜色就会消失。请注意拼写错误。

**函数** — 以 `:函数<参数<值` 的形式加工颜色。不需要写右括号。

| 函数 | 效果 |
|---|---|
| `:lighten<10<@accent` | 调亮 |
| `:darken<10<@accent` | 调暗 |
| `:alpha<0.3<@accent` | 替换不透明度（不是相乘） |
| `:hue<20<@accent` | 旋转色相 |
| `:saturate<15<@accent` | 提高饱和度（负数为降低） |

可以像 `':alpha<0.5<:lighten<10<@accent'` 这样嵌套。不在表中的函数名不会被解释，字符串会原样输出，导致显示错乱。函数的输入不能使用 `red` 这样的颜色名称。

**原始 CSS** — 在开头放一个 `"`，之后的内容就会原样作为 CSS 值。不需要闭合。其他值可以用 `var(--MI_THEME-属性名)` 引用。

```json5
panelBorder: '" solid 1px var(--MI_THEME-divider)',
```

::: warning 不能使用 `$常量`
Misskey 本身的主题格式允许在 `props` 中以 `$名称` 定义常量，但 NoteDeck 尚不支持，会得到空值。请用 `@` 引用代替。
:::

## 制作与发布

可以在 AI 列中提出“做一个某某风格的主题”。手动编写时，请放在设置文件夹中。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#テーマ)）。
