---
sourceHash: 14d7254d7da0
---

# What is NoteDeck

NoteDeck is a desktop and mobile app for using Misskey as a **deck**. Timelines, notifications, search, chat and more sit side by side as vertical columns, so you can handle several accounts and servers on one screen.

Compared with the Misskey web UI you open in a browser, it differs in these ways:

- **Columns can span accounts** — assign a different account to each column, or gather notifications from every account into a single column
- **Notes that scrolled by stay with you** — notes you have seen are stored in a local database and can be found later with full-text search
- **It uses your OS** — global hotkeys, native notifications, the system tray, and popping content out into separate windows

::: info The app is in Japanese for now
The app's interface is currently available in Japanese only ([#135](https://github.com/notedeck-dev/notedeck/issues/135) tracks translating it). These docs give the Japanese label next to each button or menu name so you can find it on screen.
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
- Want to edit the settings files directly → [Settings files](/en/docs/config/files)

## Why we call it an "IDE"

NoteDeck calls itself an Integrated Deck Environment. Just as an editor is more than a place to type text once it ships a debugger and a terminal, NoteDeck does not stop at being a tool for reading and writing Misskey.

- An [inspector](/en/docs/deck/columns#tool-columns) that shows traffic with the server as it is
- Plugins, themes and widgets installed from the [store](/en/docs/guide/store)
- AiScript, which turns code you write into commands
- A way to keep [AI](/en/docs/guide/ai) around as a partner

You can use it as an ordinary client without any of that, but the further you go, the more it becomes your own tool.
