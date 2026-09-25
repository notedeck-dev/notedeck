---
sourceHash: e642e3e818c4
---

# Build extensions

NoteDeck is not only about using the features that ship with it — you can add your own. There are 5 kinds of things you can add, each with its own role and language.

| Kind | What it does | Written in |
|---|---|---|
| [Plugins](/en/docs/dev/plugin) | Add actions on notes and users. Rewrite posts, add commands | AiScript |
| [Widgets](/en/docs/dev/widget) | Place a small UI. Clocks, tallies, data from outside | AiScript |
| [Themes](/en/docs/dev/theme) | Change the colors | JSON5 |
| [Column queries](/en/docs/dev/query) | Filter and sort the notes that flow into a column | A subset of AiScript |
| [Skills](/en/docs/dev/skill) | Shape how the AI behaves | Markdown |

If you are unsure, choose by what you want to change. For **looks**, a theme; for **what flows in**, a column query; for **actions**, a plugin; for **something on screen**, a widget; for **how the AI responds**, a skill.

## Three ways to make one

**Have the AI make it** — the fastest way. Ask an AI column "make a plugin that does X", and an author skill (distributed on MisStore) starts up, writes the AiScript, checks it, and saves it. You get something that works without knowing how to write it.

**Write it by hand** — open the settings folder with "File → Open settings folder" (ファイル → 設定フォルダを開く) and write directly in a text editor. You can also edit from the editor inside the app.

**Install from the store and modify it** — anything installed from the [store](/en/docs/guide/store) can be edited as is. Starting from something that already works is more reliable than writing from scratch.

## Where they live

Every extension is a file in the settings folder. They are stored separately from account information and are included in [backups](/en/docs/config/backup). For file locations and roles, see [Settings files](/en/docs/config/files).

## Share them

You can distribute what you make on [MisStore](https://store.notedeck.io). For how to submit and the curation criteria, see MisStore's own documentation ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format reference](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md)). Themes are not a NoteDeck-specific format, so they can be shared with plain Misskey as they are.
