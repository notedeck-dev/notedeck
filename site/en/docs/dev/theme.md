---
sourceHash: 645fa56e8076
---

# Themes

A theme is a color definition. It uses the same format as Misskey itself, so themes made in NoteDeck can be shared with plain Misskey as they are.

To change layout or show and hide elements rather than colors, use custom CSS from [Change the look](/en/docs/guide/appearance).

## Structure

Themes are written in JSON5. Unquoted keys, trailing commas and comments are allowed.

```json5
{
  id: '679b3b87-a4e9-4789-8696-b56c15cc33b0',  // required. A UUID by convention
  name: 'Theme name',                           // required
  base: 'dark',                                 // 'light' or 'dark'
  desc: 'Short description',                    // optional
  author: '@user@host',                         // optional
  props: { /* color definitions */ },
}
```

Keys you leave out of `props` take their values from the standard theme named in `base`. You do not need to write everything — write only what you want to change and it works.

`id` is the key for overwriting. Installing again with the same `id` replaces the existing theme, so always give a new theme a new `id`.

## Writing values

**Literal colors** — `'#f00'` `'#ff0000'` `'#ff000080'` (8 digits include alpha) `'rgb(255, 0, 0)'` `'rgba(255, 0, 0, 0.5)'`

**References** — like `'@accent'`, use another value from the same theme. References to further references or functions are resolved too. Referencing a name that does not exist yields an empty value and the color disappears, so watch for typos.

**Functions** — transform a color in the form `:function<argument<value`. There is no closing bracket.

| Function | Effect |
|---|---|
| `:lighten<10<@accent` | Lighten |
| `:darken<10<@accent` | Darken |
| `:alpha<0.3<@accent` | Replace the opacity (not multiply) |
| `:hue<20<@accent` | Rotate the hue |
| `:saturate<15<@accent` | Increase saturation (negative numbers decrease it) |

They can be nested, as in `':alpha<0.5<:lighten<10<@accent'`. Function names not listed here are not interpreted; the string comes out as is and things look broken. Color names such as `red` cannot be used as function input.

**Raw CSS** — put a single `"` at the start and the rest becomes a CSS value as is. It is not closed. Other values can be referenced with `var(--MI_THEME-property-name)`.

```json5
panelBorder: '" solid 1px var(--MI_THEME-divider)',
```

::: warning `$constants` are not supported
Misskey's theme format lets you define constants inside `props` as `$name`, but NoteDeck does not support this and they come out empty. Use `@` references instead.
:::

## Make and share

Ask an AI column "make a theme that feels like X". To write one by hand, put it in the settings folder. You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#テーマ)).
