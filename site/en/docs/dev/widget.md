---
sourceHash: 6d4fe29094a3
---

# Widgets

Widgets are extensions for placing a small UI on screen. They are written in AiScript and used for things like clocks, tallies, or showing data fetched from outside. Unlike plugins they have no hooks — they simply draw when run.

## Minimal example

Call `Ui:render` at the top level. Unlike plugins, a meta header is not required, but writing one makes widgets easier to manage.

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

Build the UI by lining up `Ui:C:*` components. Text, buttons, input fields and more are available.

## Keeping state

`Mk:save` and `Mk:load` store values in a per-widget area. They persist across re-renders and app restarts.

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

## Auto-run

By default widgets are started manually. Opening the column does not run them; they run when you press "Start" (起動). You can switch to auto-run, but note that for widgets that talk to the outside, simply opening them causes network requests. You can switch back at any time.

## Make and share

Ask an AI column "make a widget that shows X". To write one by hand, put two files in the settings folder: the code and its metadata. You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)).
