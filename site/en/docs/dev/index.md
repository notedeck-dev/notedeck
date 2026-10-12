---
sourceHash: 58deeb8c3b37
---

# Build extensions

NoteDeck is not only about using the features that ship with it — you can add your own. There are 5 kinds of things you can add, each with its own role and language.

| Kind | What it does | Written in |
|---|---|---|
| [Plugins](/en/docs/dev/plugin) | Add actions on notes and users. Rewrite posts, add commands | AiScript |
| [Widgets](/en/docs/dev/widget) | Place a small UI. Clocks, tallies, data from outside | AiScript |
| [Themes](/en/docs/dev/theme) | Change the colors | JSON5 |
| [Column queries](/en/docs/dev/query) | Narrow down the notes that flow into a column | A subset of AiScript |
| [Skills](/en/docs/dev/skill) | Shape how the AI behaves | Markdown |

If you are unsure, choose by what you want to change. For **looks**, a theme; for **what flows in**, a column query; for **actions**, a plugin; for **something on screen**, a widget; for **how the AI responds**, a skill.

::: tip Creating and editing need developer mode
For all 5 kinds, anyone can install from the store, turn them on or off and delete them, but the entrance for **creating new ones and editing their contents** is opened by [developer mode](/en/docs/#developer-mode). It is off by default on a fresh install.
:::

## Three ways to make one

**Have the AI make it** — the fastest way. First install the author skills from [MisStore](https://store.notedeck.io) (the author skill for each of plugins / widgets / themes / queries / skills, together with the companion skills such as the AiScript syntax reference), then ask an AI column "make a plugin that does X": the AI writes it, checks it and saves it. You get something that works without knowing how to write it. To let it make themes, allow theme writes in the [permissions](/en/docs/guide/ai#permissions) (off by default).

**Write it by hand** — open the settings folder with "File → Open settings folder" (ファイル → 設定フォルダを開く) and write directly in a text editor. In developer mode you can also edit from the editor inside the app.

**Install from the store and modify it** — anything installed from the [store](/en/docs/guide/store) can be edited as is. Starting from something that already works is more reliable than writing from scratch. Edits keep a history, so you can go back to a previous version.

## Where they live

Every extension is a file in the settings folder. They are stored separately from account information and are included in [backups](/en/docs/config/backup). For file locations and roles, see [Settings files](/en/docs/config/files). The one exception is the values plugins and widgets keep with `Mk:save`: those live in the app's internal storage rather than in files, and are not included in backups.

For all 5 kinds, what you install is managed in two pools, **for all accounts** and **per account** (an item can also just sit in the library without being used anywhere). A plugin you only use on a certain server can be enabled without affecting other accounts.

## Share them

You can distribute what you make on [MisStore](https://store.notedeck.io). For how to submit and the curation criteria, see MisStore's own documentation ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format reference](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md)). Themes are not a NoteDeck-specific format, so they can be shared with plain Misskey as they are.
