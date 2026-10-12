---
sourceHash: ef8d7a341889
---

# Changing the look

## Themes

Misskey themes work as they are. You can load theme code distributed for upstream Misskey, install themes from the [store](/en/docs/guide/store), or make your own.

Light / dark follows your OS setting. You can also pin it manually (toggle with the single key `d`).

The app has one theme overall, but a column can reflect **the theme that account has chosen on the Misskey side** (or the server's default theme if none). Each server gets its own colors, so you can tell at a glance which account you are working as.

## Deck wallpaper

You can set an image as the deck background. It shows through the gaps between columns.

## Pet

You can put a pet on the deck. Enter a slug or URL from [petdex.dev](https://petdex.dev) under "Pet" in the appearance settings and it appears; you can change its size. It moves along with what the AI is doing.

## Screen size

`Ctrl++` / `Ctrl+-` zoom the whole screen in and out, and `Ctrl+0` resets it. The setting that "nyaizes" note text also lives here.

## Fine-tuning with CSS

Where themes cannot reach, write CSS directly in `custom.css`. For where the file lives, see [Settings files](/en/docs/config/files).

Note elements carry attributes that identify them. For example, you can style your own posts differently from others', or change colors by visibility, with CSS alone.

::: warning Updates can break it
`custom.css` touches the internal structure directly, so it may stop working after an app update. If things break and the display looks wrong, start by emptying `custom.css` to narrow it down. Edits keep a history.
:::

## Choosing how light it renders

A single slider moves how heavy rendering is from "Low memory" to "High performance" to suit your device. Turn on "Adapt automatically to power, network and window state" and, on battery or in power-saving mode, image prefetching and animated emoji stop; on metered connections, images and videos load on tap; while the window is hidden, timeline subscriptions pause.

To tune the exact numbers, edit `performance.json5` directly (the tab that edits it as it is appears in [developer mode](/en/docs/#developer-mode)).
