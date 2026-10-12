---
sourceHash: d9dad1fc2339
---

# 主题

主题是配色的定义。它与 Misskey 本身使用相同的格式，因此在 NoteDeck 中制作的主题也可以原样分享给普通的 Misskey 使用。

如果想改变的不是配色，而是布局或元素的显示/隐藏，请使用[更改外观](/zh/docs/guide/appearance)中的自定义 CSS。

## 结构

用 JSON5 编写。可以省略键的引号，可以使用末尾逗号和注释。

```json5
{
  id: '679b3b87-a4e9-4789-8696-b56c15cc33b0',  // 覆盖时使用的键。惯例使用 UUID。没有则自动分配
  name: '主题名称',                              // 没有则为 'Untitled'
  base: 'dark',                                 // 'light' 或 'dark'
  desc: '一句话说明',                            // 可选
  author: '@user@host',                         // 可选
  props: { /* 颜色定义 */ },                     // 必填
}
```

`props` 中没有写的键，会使用 `base` 指定的标准主题的值。不需要全部写出，只写想改的部分就能工作。

`id` 是覆盖时使用的键。通过粘贴或代码用相同的 `id` 重新安装会替换已有的主题，因此新主题请务必分配新的 `id`。

只在 NoteDeck 中使用的信息（商店的 id 等）放在 `$notedeck` 之下。普通的 Misskey 会忽略这个键。

## 值的写法

**字面颜色** — `'#f00'` `'#ff0000'` `'#ff000080'`（8 位表示带透明度）`'rgb(255, 0, 0)'` `'rgba(255, 0, 0, 0.5)'`，此外 `hsl()` / `hsla()` / `oklch()` 以及空格分隔的 `rgb(r g b / a)` 也能被解释。

**引用** — 像 `'@accent'` 这样，使用同一主题中的其他值。即使被引用的值本身又是引用或函数，也会被解析。引用不存在的名称会得到空值，那个颜色就会消失。请注意拼写错误。

**常量** — 在 `props` 中写成 `$名称: '#...'` 的值，会成为可以用 `'$名称'` 引用的常量。它不会作为 CSS 变量输出（与 Misskey 本身相同）。

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

## 只在 NoteDeck 中生效的 prop

`accentDarken`（强调色的深色版）和 `accentText`（放在强调色之上的文字颜色）如果没有写，会从 `accent` 自动生成。普通的 Misskey 没有这些 prop，所以在那边不会生效。

## 保存位置

以 `<slug>.ndtheme.json5` 的形式保存在设置文件夹的 `themes/` 中。手动放置时，把原始的 `.json5`（例如从 Misskey 复制的主题）放到这个文件夹里也会被导入，但那只是**一次性的复制**，之后编辑源文件不会反映过来。导入后会分配新的 id，原来的 `id` 不再使用。

## 制作与发布

可以在 AI 列中提出“做一个某某风格的主题”（需要先安装 MisStore 的作者技能，并在[权限](/zh/docs/guide/ai#权限)中允许写入主题。默认是关闭的）。创建与编辑的入口在[开发者模式](/zh/docs/#开发者模式)下开放。制作的内容可以在 [MisStore](https://store.notedeck.io) 上发布（[提交方法](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [格式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#テーマ)）。
