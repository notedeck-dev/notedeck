---
sourceHash: fdaac9c0209a
---

# Changing the look

## Themes

Misskey themes work as they are. You can load theme code distributed for upstream Misskey, install themes from the [store](/en/docs/guide/store), or make your own.

Light / dark follows your OS setting. You can also pin it manually.

Themes are **tied to each account**. Give each server its own colors and you can tell at a glance which account you are working as. What they apply to follows switching between [profiles](/en/docs/deck/profiles).

## Deck wallpaper

You can set an image as the deck background. It shows through the gaps between columns.

## Fine-tuning with CSS

Where themes cannot reach, write CSS directly in `custom.css`. For where the file lives, see [Settings files](/en/docs/config/files).

Note elements carry attributes that identify them. For example, you can style your own posts differently from others', or change colors by visibility, with CSS alone.

::: warning Updates can break it
`custom.css` touches the internal structure directly, so it may stop working after an app update. If things break and the display looks wrong, start by emptying `custom.css` to narrow it down.
:::

## Choosing how light it renders

Switch how heavy rendering is with presets to suit your device, leaning toward low memory or toward smoothness. The frame rate adjusts to your device automatically.

To tune the exact numbers, edit `performance.json5` directly.
