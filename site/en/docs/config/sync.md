---
sourceHash: b8e6ddf7ef0d
---

# Managing settings with Git

All of NoteDeck's settings sit in one folder inside the app data folder: **`config/`**. That single folder is the unit you carry around, and **it is built to be managed with Git**, just like dotfiles.

Everything outside `config/` (the note cache, AI conversations, window positions, consents and whether keys are present) is not meant to travel. [Settings files](/en/docs/config/files#where-settings-live) explains what lives where.

::: warning Do not publish it
`config/` contains which account each column looks at (`user@host`), the URLs of external services, code that runs (plugins / widgets / skills) and the actions you allow the AI and plugins to take. API keys and access tokens are not in it, but **it is not in a shape meant for a public repository**. Use a private repository.
:::

## Ground rules

- **Quit the app and the resident AI before `git pull` or editing in an external editor.** The app does not watch the settings files for outside changes. If you change them while it is open, the app's copy overwrites your change on the next action. A running resident AI (notemaid) may write `ai.json5` back as well, so stop that too. Since `pull` is something you run yourself, keeping this order is all it takes.
- **Comments disappear on re-save.** The files are JSON5 and accept comments, but when the app saves a file again the comments are not kept.
- **Writes are deterministic.** The same content produces the same bytes, and starting or merely reading never rewrites a file. Diffs do not appear "without touching anything".

## Getting started

```bash
cd ~/.local/share/com.notedeck.desktop/config   # see "Settings files" for the macOS / Windows paths
git init
git add .
git commit -m "NoteDeck settings"
```

NoteDeck places a `.gitignore` if there is none. Since `config/` holds only settings, the only thing it excludes is temporary files from writes in progress.

## Using it on another PC

1. Start NoteDeck once on the new PC and quit it (this creates the app data folder).
2. Empty `config/` and clone the repository into it (or put the cloned folder there under the name `config`).
3. Start NoteDeck and log in with the same accounts.

Columns point at accounts by `user@host`, so as soon as you log in they are bound to that PC's accounts. Columns of accounts you have not logged in to yet stay as "account not connected" and connect when you do. The files never contain values specific to one PC, so two PCs sharing one repository do not ping-pong diffs.

Connections to external services (AI providers and the like) travel as **definitions only**. API keys and the consents ("show to the AI" / "show to external apps") are this PC's state, so the settings screen asks for them when you first use the connection.

## Dotfiles managers

- Tools that **copy** files into place, such as chezmoi, work as they are.
- Tools that create per-file **symbolic links**, such as GNU stow, work too. NoteDeck reads linked files as settings and writes to the link's target (it never replaces the link with a regular file).

## About sync tools (Dropbox and the like)

You can put `config/` in a sync folder and link it back, but **NoteDeck does not guarantee this way of working**. Unlike Git, write-backs arrive while the app is open, which brings these limits.

- **One writing PC at a time.** If two PCs have NoteDeck open, the later write wins. A "conflicted copy" made by the sync tool means two files with the same id; NoteDeck skips the one sorted later and tells you with a toast. Decide which to keep and delete the other.
- **Changes made on the other PC are not picked up until you restart NoteDeck here.** A change that arrives while the app is open may be overwritten by the next action.
- **Do not point `data/` (AI conversations and memos) at a sync folder.** It contains other people's post bodies (including followers-only posts and DMs), unsent drafts and what the AI has learned about you. The one exception is syncing `data/memos/` alone as an Obsidian vault, with the same caution.
- **Do not sync `state/`, `cache/` or `notecli.db`.** They are this PC's state and cache. `notecli.db` is SQLite, and syncing it mid-write corrupts it.

If you want the same settings on several PCs, use the Git steps above.

## After updating from an older version

Settings used to live in a folder named `notedeck/`. On the first start after the update, NoteDeck splits it into `config/`, `data/`, `state/` and `cache/`. A copy of the previous contents is kept in `backups/pre-layout-<timestamp>/` inside the app data folder (it is removed after a while).

If `notedeck/` itself was a symbolic link you used for syncing, NoteDeck does not pull its contents out (they would vanish from the sync target, and with them the settings of another PC still on the old version). A notice appears at startup; split the sync target into `config` and `data`, re-create the links to `config/` and `data/`, then restart.
