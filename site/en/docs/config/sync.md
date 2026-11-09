---
sourceHash: 7fc596d4bb8f
---

# Carry settings with Git or Dropbox

All of NoteDeck's settings sit in one folder inside the app data folder: **`config/`**. That single folder is the unit you carry around. Keep its history in Git, keep it in step with another PC through Dropbox, or manage it with a dotfiles manager — any of these works.

Everything outside `config/` (the note cache, AI conversations, window positions, consents and whether keys are present) is not meant to travel, so leave it out of any sync. [Settings files](/en/docs/config/files#where-settings-live) explains what lives where.

::: warning Do not publish it
`config/` contains which account each column looks at (`user@host`), the URLs of external services, code that runs (plugins / widgets / skills) and the actions you allow the AI and plugins to take. API keys and access tokens are not in it, but **it is not in a shape meant for a public repository**. If you put it in Git, use a private repository.
:::

## Ground rules

- **Quit the app and the resident AI before changing files from outside.** Do `git pull`, edits in an external editor and sync write-backs while the app is closed. The app does not watch the settings files for outside changes, so if you change them while it is open, the app's copy overwrites your change on the next action. A running resident AI (notemaid) may write `ai.json5` back as well, so stop that too.
- **Comments disappear on re-save.** The files are JSON5 and accept comments, but when the app saves a file again the comments are not kept.
- **Writes are deterministic.** The same content produces the same bytes, and starting or merely reading never rewrites a file. Git diffs do not grow "without touching anything".

## Managing with Git

```bash
cd ~/.local/share/com.notedeck.desktop/config   # see "Settings files" for the macOS / Windows paths
git init
git add .
git commit -m "NoteDeck settings"
```

NoteDeck places a `.gitignore` if there is none. Since `config/` holds only settings, the only thing it excludes is temporary files from writes in progress.

### Using it on another PC

1. Start NoteDeck once on the new PC and quit it (this creates the app data folder).
2. Empty `config/` and clone the repository into it (or put the cloned folder there under the name `config`).
3. Start NoteDeck and log in with the same accounts.

Columns point at accounts by `user@host`, so as soon as you log in they are bound to that PC's accounts. Columns of accounts you have not logged in to yet stay as "account not connected" and connect when you do.

Connections to external services (AI providers and the like) travel as **definitions only**. API keys and the consents ("show to the AI" / "show to external apps") are this PC's state, so the settings screen asks for them when you first use the connection.

### Dotfiles managers

- Tools that **copy** files into place, such as chezmoi, work as they are.
- Tools that create per-file **symbolic links**, such as GNU stow, work too. NoteDeck reads linked files as settings and writes to the link's target (it never replaces the link with a regular file).

## Putting it in a Dropbox-style sync folder

Move `config/` as a whole, or a part such as `config/profiles/`, into the sync folder and link it back to the original place.

```bash
# Example: sync only the profiles through Dropbox
mv ~/.local/share/com.notedeck.desktop/config/profiles ~/Dropbox/notedeck-profiles
ln -s ~/Dropbox/notedeck-profiles ~/.local/share/com.notedeck.desktop/config/profiles
```

- **One writing PC at a time.** If two PCs have NoteDeck open and write to the same folder, the later write wins. When the sync tool creates a "conflicted copy", two files carry the same id; NoteDeck skips the one sorted later and tells you with a toast. Decide which to keep and delete the other.
- **Do not point `data/` (AI conversations and memos) at a sync folder.** It contains other people's post bodies (including followers-only posts and DMs), unsent drafts and what the AI has learned about you. That does not belong in an unencrypted cloud.
- **Do not sync `state/`, `cache/` or `notecli.db`.** They are this PC's state and cache. `notecli.db` is SQLite, and syncing it mid-write corrupts it.

## After updating from an older version

Settings used to live in a folder named `notedeck/`. On the first start after the update, NoteDeck splits it into `config/`, `data/`, `state/` and `cache/`. A copy of the previous contents is kept in `backups/pre-layout-<timestamp>/` inside the app data folder (it is removed after a while).

If `notedeck/` itself was a symbolic link you used for syncing, NoteDeck does not pull its contents out (they would vanish from the sync target, and with them the settings of another PC still on the old version). A notice appears at startup; split the sync target into `config` and `data`, re-create the links to `config/` and `data/`, then restart.
