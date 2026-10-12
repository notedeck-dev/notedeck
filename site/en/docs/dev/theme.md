---
sourceHash: d9dad1fc2339
---

# Themes

A theme is a color definition. It uses the same format as Misskey itself, so themes made in NoteDeck can be shared with plain Misskey as they are.

To change layout or show and hide elements rather than colors, use custom CSS from [Changing the look](/en/docs/guide/appearance).

## Structure

Themes are written in JSON5. Unquoted keys, trailing commas and comments are allowed.

```json5
{
  id: '679b3b87-a4e9-4789-8696-b56c15cc33b0',  // the key for overwriting. A UUID by convention; assigned if missing
  name: 'Theme name',                           // 'Untitled' if missing
  base: 'dark',                                 // 'light' or 'dark'
  desc: 'Short description',                    // optional
  author: '@user@host',                         // optional
  props: { /* color definitions */ },           // required
}
```

Keys you leave out of `props` take their values from the standard theme named in `base`. You do not need to write everything — write only what you want to change and it works.

`id` is the key for overwriting. Installing again from a paste or from code with the same `id` replaces the existing theme, so always give a new theme a new `id`.

Information used only by NoteDeck (such as the store id) goes under `$notedeck`. Plain Misskey ignores this key.

## Writing values

**Literal colors** — `'#f00'` `'#ff0000'` `'#ff000080'` (8 digits include alpha) `'rgb(255, 0, 0)'` `'rgba(255, 0, 0, 0.5)'`, as well as `hsl()` / `hsla()` / `oklch()` and the space-separated `rgb(r g b / a)` are understood.

**References** — like `'@accent'`, use another value from the same theme. References to further references or functions are resolved too. Referencing a name that does not exist yields an empty value and the color disappears, so watch for typos.

**Constants** — a value written inside `props` as `$name: '#...'` becomes a constant you can reference as `'$name'`. It is not emitted as a CSS variable (same as upstream).

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

## Props that only work in NoteDeck

`accentDarken` (a darker version of the accent) and `accentText` (the text color placed on top of the accent) are derived from `accent` automatically when not written. They are props plain Misskey does not have, so they have no effect there.

## Where they are stored

Themes are stored in `themes/` in the settings folder as `<slug>.ndtheme.json5`. When placing one by hand, dropping a plain `.json5` (such as a theme copied from Misskey) into this folder is enough to import it, but that is a **one-time copy**: later edits to the original file are not picked up. After import it gets a new id, and the original `id` is not used.

## Make and share

Ask an AI column "make a theme that feels like X" (install the author skill from MisStore first, and allow theme writes in the [permissions](/en/docs/guide/ai#permissions); it is off by default). The entrance for creating and editing is opened by [developer mode](/en/docs/#developer-mode). You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#テーマ)).
