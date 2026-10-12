---
sourceHash: 24e5a61f3727
---

# Settings files

All of NoteDeck's settings live as files on your device. Anything you change in the UI is written straight to those files, and you are free to edit them directly in an external editor.

The format is **JSON5**. You can write comments, and trailing commas are allowed.

The exceptions are the currently open profile, widget placements, and the values plugins and widgets keep with `Mk:save`: those live in the app's internal storage rather than in files.

## Where settings live

**File → Open settings folder** (ファイル → 設定フォルダを開く) opens Explorer / Finder. This is the most reliable way.

If you want the path, it is under your OS's application data area.

| OS | Location |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

One level up, `com.notedeck.desktop/` is the app data folder, which holds the note cache `notecli.db`, the logs, and the account list the AI process copied from the app (`notemaid-accounts.json`). The environment variable `NOTEDECK_APP_DIR` changes where the app data folder is.

The same menu also opens the log, download and backup folders.

## What is written where

| File | Contents |
|---|---|
| `settings.json5` | Where simple values collect: theme choice, modes, mutes, cache settings and so on |
| `keybinds.json5` | [Keybinding](/en/docs/guide/keyboard) overrides |
| `navbar.json5` | The [navbar](/en/docs/deck/navbar) button layout |
| `performance.json5` | Rendering tuning values |
| `postform.json5` | Post form settings |
| `ai.json5` | [AI](/en/docs/guide/ai) connection and model choice, HEARTBEAT settings |
| `tasks.json5` | Declarations of the tasks run from the Tasks column |
| `permissions.json5` | Actions allowed for plugins and the AI. If it is broken, the app starts with every row read-only |
| `locale.json5` | Display language |
| `tutorial.json5` | Tutorial progress and achievements |
| `custom.css` | [Appearance overrides](/en/docs/guide/appearance#fine-tuning-with-css) (history in `custom.css.history.json5`) |
| `theme-dropins.json5` | Record of themes imported after being dropped into `themes/` by hand |
| `client.json5` | Configuration for this device only (such as how to connect to [the AI process](/en/docs/notemaid)). Not part of backups |

Some things are kept as folders.

| Folder | Contents |
|---|---|
| `profiles/` | Deck profiles (`*.ndprofile.json5`) |
| `themes/` | Themes (`*.ndtheme.json5`) |
| `plugins/` `widgets/` `queries/` | Pairs of code `*.is` and metadata `*.meta.json5` |
| `skills/` | Skills (`*.md`). `AGENTS.md` and `HEARTBEAT.md` are reserved |
| `snippets/` | Scratchpad snippets |
| `memos/` | Memos (`*.md`) |
| `sessions/` | AI conversations. Saved with permissions only you can read |
| `notemaid/` | The AI's personality and memory |

File names are slugs made from the display name (or the storeId for store items), and references use the id inside the file. If two files share the same id, the later one is skipped and a toast tells you.

`memos/` contains plain Markdown files, so you can open it as an Obsidian vault.

`notemaid/` holds the AI's personality and memory: three Markdown files, `SOUL.md` (personality), `USER.md` (what it remembers about you) and `MEMORY.md` (notes to self), plus a first-run-only `BOOTSTRAP.md`. Editing them in an external editor takes effect from the next conversation (the AI is told they were changed outside NoteDeck). You can also read and edit them under "Persona" and "Memory" in the Agent settings; only the body of `SOUL.md` is edited in a developer-mode tab or an external editor. `AGENTS.md` (rules) and `HEARTBEAT.md` (steps of the rounds) under `skills/` have fixed names and roles, cannot be deleted or renamed, and do not appear in the Skills column (edit them from the Agent settings). Only the three Markdown files go into backups.

::: tip API keys are not here
Access tokens and AI API keys are in the OS keychain (on Linux without Secret Service, they fall back to an encrypted file). Even if you hand the settings folder to someone as is, no keys are included.
:::

## Editing from inside the app

You can edit without an external editor, from the settings editor window. In [developer mode](/en/docs/#developer-mode), tabs that edit `settings.json5` and others as they are appear too.

Changes generally **take effect without a restart**. Files rewritten in an external editor are also reloaded the next time they are used.

## If you make a mistake

A file that is broken as JSON5 fails to load, and the settings in that file fall back to their defaults (only `permissions.json5` fails safe: every row becomes read-only). If something seems off, delete the file in question once (it is recreated with defaults).
