---
sourceHash: 574a2e64954a
---

# Settings files

All of NoteDeck's settings live as files on your device. Anything you change in the UI is written straight to those files, and you are free to edit them directly in an external editor.

The format is **JSON5**. You can write comments, and trailing commas are allowed.

## Where settings live

**File → Open settings folder** (ファイル → 設定フォルダを開く) opens Explorer / Finder. This is the most reliable way.

If you want the path, it is under your OS's application data folder.

| OS | Location |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

The same menu also opens the log, download and backup folders.

## What is written where

| File | Contents |
|---|---|
| `settings.json5` | Where simple values collect: theme choice, modes, mutes, cache settings and so on |
| `keybinds.json5` | [Keybinding](/en/docs/guide/keyboard) overrides |
| `navbar.json5` | The [navbar](/en/docs/deck/navbar) button layout |
| `performance.json5` | Rendering tuning values |
| `postform.json5` | Post form settings |
| `ai.json5` | [AI](/en/docs/guide/ai) connections and model choice |
| `AI.md` | Instructions passed to the AI |
| `tasks.json5` | Contents of the tasks column |
| `permissions.json5` | Actions allowed for plugins and the AI |
| `custom.css` | [Appearance overrides](/en/docs/guide/appearance#fine-tuning-with-css) |

Some things are kept as folders.

`profiles/` `themes/` `plugins/` `widgets/` `skills/` `queries/` `snippets/` `memos/` `sessions/`

`memos/` contains plain Markdown files, so you can open it as an Obsidian vault.

::: tip API keys are not here
Access tokens and AI API keys are in the OS keychain. Even if you hand the settings folder to someone as is, no keys are included.
:::

## Editing from inside the app

You can edit without an external editor, from the settings editor window. `settings.json5` can also be edited directly in the Raw JSON editor.

Changes generally **take effect without a restart**. Files rewritten in an external editor are also reloaded the next time they are used.

## If you make a mistake

A file that is broken as JSON5 fails to load, and the settings in that file fall back to their defaults. If something seems off, delete the file in question once (it is recreated with defaults).
