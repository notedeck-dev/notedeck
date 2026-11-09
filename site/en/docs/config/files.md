---
sourceHash: 922a7353e8ee
---

# Settings files

All of NoteDeck's settings live as files on your device. Anything you change in the UI is written straight to those files, and you are free to edit them directly in an external editor.

The format is **JSON5**. You can write comments, and trailing commas are allowed (comments disappear when the app saves the file again).

The exceptions are the currently open profile, widget placements, and the values plugins and widgets keep with `Mk:save`: those live in the app's internal storage rather than in files.

## Where settings live

**File → Open settings folder** (ファイル → 設定フォルダを開く) opens Explorer / Finder. This is the most reliable way.

If you want the path, it is under your OS's application data area.

| OS | App data folder |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/` |
| Linux | `~/.local/share/com.notedeck.desktop/` |

The environment variable `NOTEDECK_APP_DIR` changes where the app data folder is. The same menu also opens the log, download and backup folders.

The app data folder is split into four parts by how each should be treated.

| Folder | What it is | Carry / sync |
|---|---|---|
| `config/` | **Settings.** Column layout, themes, keybindings, plugins, AI connections and so on | Yes ([Carry settings with Git or Dropbox](/en/docs/config/sync)) |
| `data/` | **Your records.** Memos, AI conversations, the AI's personality and memory | Not recommended: it contains other people's post bodies |
| `state/` | **This PC's state.** Window positions, zoom, consents and whether keys are present, "don't ask again" memory, edit history | No |
| `cache/` | **Disposable.** Images, emoji, pet sprites | No |

Beside them, directly in the app data folder, are the note cache and account information `notecli.db` (SQLite; never sync it), the AI process's logs in `logs/`, and `backups/` from updating an older version.

::: tip If you updated from an older version
Settings, records and state used to share one folder named `notedeck/`. The first start after the update moves them into the layout above, and a copy of the previous contents stays in `backups/pre-layout-<timestamp>/`.
:::

## What is in `config/`

| File | Contents |
|---|---|
| `settings.json5` | Where simple values collect: theme choice, modes, mutes, cache settings and so on |
| `keybinds.json5` | [Keybinding](/en/docs/guide/keyboard) overrides |
| `navbar.json5` | The [navbar](/en/docs/deck/navbar) button layout |
| `performance.json5` | Rendering tuning values |
| `postform.json5` | Post form settings |
| `ai.json5` | [AI](/en/docs/guide/ai) connection and model choice, HEARTBEAT settings |
| `tasks.json5` | Declarations of the tasks run from the Tasks column |
| `permissions.json5` | The policy of actions allowed for plugins and the AI. If it is broken, the app starts with every row read-only |
| `connections.json` | Definitions of connections to external services (URL and auth method; the keys and consents are on the `state/` side) |
| `locale.json5` | Display language |
| `custom.css` | [Appearance overrides](/en/docs/guide/appearance#fine-tuning-with-css) |
| `.gitignore` | A template for people who manage the folder with Git. Created if missing, never touched if present |

Some things are kept as folders.

| Folder | Contents |
|---|---|
| `profiles/` | Deck profiles (`*.ndprofile.json5`). Columns point at accounts by `user@host` |
| `themes/` | Themes (`*.ndtheme.json5`) |
| `plugins/` `widgets/` `queries/` | Pairs of code `*.is` and metadata `*.meta.json5` |
| `skills/` | Skills (`*.md`). `AGENTS.md` and `HEARTBEAT.md` are reserved |
| `snippets/` | Scratchpad snippets |

File names are slugs made from the display name (or the storeId for store items), and references use the id inside the file. If two files share the same id, the later one is skipped and a toast tells you.

::: tip API keys are not here
Access tokens and AI API keys are in the OS keychain (on Linux without Secret Service, they fall back to an encrypted file). Even if you hand `config/` to someone as is, no keys are included. It is still not something to publish, though ([what to watch out for when carrying it](/en/docs/config/sync)).
:::

## What is in `data/`

| Folder | Contents |
|---|---|
| `memos/` | Memos (`*.md`). Plain Markdown, so you can open it as an Obsidian vault |
| `sessions/` | AI conversations. Saved with permissions only you can read |
| `notemaid/` | The AI's personality and memory |

`notemaid/` holds three Markdown files, `SOUL.md` (personality), `USER.md` (what it remembers about you) and `MEMORY.md` (notes to self), plus a first-run-only `BOOTSTRAP.md`. Editing them in an external editor takes effect from the next conversation (the AI is told they were changed outside NoteDeck). You can also read and edit them under "Persona" and "Memory" in the Agent settings; only the body of `SOUL.md` is edited in a developer-mode tab or an external editor. `AGENTS.md` (rules) and `HEARTBEAT.md` (steps of the rounds) under `config/skills/` have fixed names and roles, cannot be deleted or renamed, and do not appear in the Skills column (edit them from the Agent settings). Only the three Markdown files go into backups.

## What is in `state/`

You never need to touch these, and deleting them does not lose any settings.

| File | Contents |
|---|---|
| `ui.json5` | Pet position, zoom, the visibility last used in the post form |
| `deck/<profile id>.json5` | The layout of popped-out windows and in-progress column input (search terms and the like) |
| `connections-meta.json` | Per-connection consents (show to the AI / to external apps), whether a key is stored, when it was last used |
| `permissions-meta.json5` | "Don't ask again" memory and a copy of last start's permissions (you are told at startup if they widened from outside) |
| `client.json5` | Configuration for this PC only (how to connect to [the AI process](/en/docs/notemaid)) |
| `tutorial.json5` | Tutorial progress and achievements |
| `theme-dropins.json5` | Record of themes imported after being dropped into `themes/` by hand |
| `history/` | The contents of settings files before each edit (read by the history window) |
| `notemaid/` `secrets/` | The AI process's working state, and records of tokens for external apps |

## Editing from inside the app

You can edit without an external editor, from the settings editor window. In [developer mode](/en/docs/#developer-mode), tabs that edit `settings.json5` and others as they are appear too.

Changes generally **take effect without a restart**. If you rewrite files in an external editor, do it while the app is closed. The app does not watch for outside changes, so if you change files while it is open, the app's copy overwrites them on the next action.

## If you make a mistake

A file that is broken as JSON5 fails to load, and the settings in that file fall back to their defaults (only `permissions.json5` fails safe: every row becomes read-only). If something seems off, delete the file in question once (it is recreated with defaults).
