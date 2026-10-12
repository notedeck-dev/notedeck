---
sourceHash: ac5f7065e02c
---

# What is NoteDeck

NoteDeck is a desktop and mobile app for using Misskey as a **deck**. Timelines, notifications, search, chat and more sit side by side as vertical columns, so you can handle several accounts and servers on one screen.

Compared with the Misskey web UI you open in a browser, it differs in these ways:

- **Columns can span accounts** — assign a different account to each column, or gather notifications from every account into a single column
- **Notes that scrolled by stay with you** — notes you have seen are stored in a local database and can be found later with full-text search
- **It uses your OS** — global hotkeys, native notifications, the system tray, and popping content out into separate windows

NoteDeck is a "client" with no server of its own. You create your account on a Misskey server such as misskey.io, and log in to NoteDeck with that account.

::: info Language of the app
The app's interface is available in Japanese and English. It follows your OS language by default, and you can change it under Appearance → Language. These docs also give the Japanese label next to each button or menu name, for when you use the app in Japanese.
:::

## Three basic concepts

Learn these three and you can read the NoteDeck screen.

| Concept | What it is | Does it persist? |
|---|---|---|
| **Column** | A tall area for things that keep flowing: timelines, notifications, chat, AI and so on | Yes. It survives an app restart |
| **Window** | A small window opened for the moment: note details, profiles, settings, editors and so on | No. It disappears when closed |
| **Profile** | A saved arrangement of columns. Switch between them per purpose | Yes |

"Things that keep flowing are columns, things you only need right now are windows." For details, see [Columns and windows](/en/docs/deck/columns).

## Where to start

- First time → [Installation](/en/docs/install) → [First-run setup](/en/docs/first-run)
- Want to try without creating an account → [Try without logging in](/en/docs/guest)
- How to lay out the screen → [Columns and windows](/en/docs/deck/columns)
- Want to work without a mouse → [Keyboard](/en/docs/guide/keyboard)
- Want to connect an AI, or learn how the separate process works → [Using AI](/en/docs/guide/ai) / [The AI process (notemaid)](/en/docs/notemaid)
- Want to edit the settings files directly → [Settings files](/en/docs/config/files)

## Why we call it an "IDE"

NoteDeck calls itself an Integrated Deck Environment. Just as an editor is more than a place to type text once it ships a debugger and a terminal, NoteDeck does not stop at being a tool for reading and writing Misskey.

- An [inspector](/en/docs/deck/columns#columns-for-developers) that shows traffic with the server as it is
- Plugins, themes and widgets installed from the [store](/en/docs/guide/store)
- AiScript, which turns code you write into commands
- A way to keep [AI](/en/docs/guide/ai) around as a partner

You can use it as an ordinary client without any of that, but the further you go, the more it becomes your own tool.

## Developer mode

The entrances for going further are hidden by default. Turn on "Developer mode" (開発者モード) in the **About NoteDeck** window, or run "Toggle developer mode" (開発者モードを切り替え) from the command palette, and they open up.

Developer mode reveals the API console / API docs / Stream / Scratchpad / Tasks columns, the raw data (Raw JSON) of notes and notifications, the tabs that edit settings files as they are, and the **creation and editing** of themes, plugins, widgets, queries and skills. If you only install things from the store and use them, you do not need developer mode.

Only the entrances are hidden. Columns already placed on the deck keep working after you turn developer mode off. AI is exempt from this and is always shown.
