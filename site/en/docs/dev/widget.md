---
sourceHash: c6c7b7b84e50
---

# Widgets

Widgets are extensions for placing a small UI on screen. They are written in AiScript and used for things like clocks, tallies, or showing data fetched from outside. Unlike plugins they have no hooks — they simply draw when run.

## Minimal example

Call `Ui:render` at the top level. A plugin-style meta header is not interpreted. The name and the auto-run setting live in the meta file placed next to it (described below).

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

Build the UI by lining up `Ui:C:*` components. Text, buttons, input fields and more are available.

## Keeping state

`Mk:save` and `Mk:load` store values. They persist across re-renders and app restarts. The storage is separate per "widget × account it runs as", so placing the same widget under a different account does not mix the values. These values live in the app's internal storage rather than a file, and are not included in [backups](/en/docs/config/backup).

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

By default widgets are started manually. Opening the column does not run them; they run when you press "Run" (実行). You can switch "Auto-run" (自動実行) on, but note that for widgets that talk to the outside, simply opening them causes network requests. You can switch back at any time.

Which account a widget runs as is held by its placement in the Widget column. What widgets can do is decided by the same rules as the "Plugins" row of the [permission settings](/en/docs/guide/ai#permissions).

## Where they are stored

Widgets are stored in `widgets/` in the settings folder as two files: the code `<slug>.is` and the metadata `<slug>.meta.json5` (name, auto-run, whether it is for all accounts, which accounts it was added to, and the created / updated timestamps). The list is built from the meta files.

## Make and share

Ask an AI column "make a widget that shows X" (install the author skill from MisStore first). The entrance for creating and editing is opened by [developer mode](/en/docs/#developer-mode). You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)).
