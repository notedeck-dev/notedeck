---
sourceHash: 711d9f6d9ebc
---

# Columns and windows

The NoteDeck screen is made of **columns** and **windows**. Once you know when to use which, the rest is just arranging them.

## "Does it keep flowing?" decides which one

| | Column | Window |
|---|---|---|
| What goes there | Things that keep flowing (timelines, notifications, chat, AI) | Things you only need right now (note details, profiles, settings) |
| How it appears | A tall area lined up in the deck | A small window floating in front |
| When closed | Saved in the profile and shown again next time | Gone. Not saved |

Clicking a note opens its details in a **window** because that is a one-off view. A timeline keeps flowing, so it is a **column**.

## Working with columns

- **Add** — from the "Add column" (カラム追加, +) button or the command palette (`Ctrl+K`)
- **Reorder** — drag the column header
- **Resize** — drag the border between columns. The width is remembered
- **Remove** — from the column header's menu

### Pop out into a separate window

A column can be popped out into its own OS window. With multiple monitors, you can, for example, put only notifications on a secondary display.

**PiP** (a small always-on-top window) is supported too, so you can keep a timeline flowing while working in other apps.

## Assigning accounts

For each column you choose which account it runs as.

- **A specific account** — shows things from that account's point of view (a normal timeline and so on)
- **All accounts** (全アカウント) — merges every account into a single column

"All accounts" is available for notifications, mentions, direct, messages, follow requests, server search, lookup and favorites, as well as timelines (home and global only; the same note seen on several servers is folded into one) and the tool columns. Types that cannot be set to "All accounts" appear in the "Add column" dialog as disabled rows with the reason. If you use several servers and do not want to miss notifications, placing a single notifications column set to "All accounts" is the easy way.

## Column types

The "Add column" dialog is split into three groups. The dialog is the source of truth for column names and the full list.

### Account

Things tied to your own account: timeline, notifications, drive, follow requests, lists, antennas, favorites, clips, mentions, direct, messages (chat), achievements and so on.

### Server

Things that show information from the server side. Many of them can be viewed without logging in: server info, About Misskey, custom emoji, ads, explore, announcements, server search, lookup, channels, roles, gallery, Misskey Play, pages, users, charts, federation and so on.

### Tools

Work columns unique to NoteDeck. Some of them have nothing directly to do with Misskey servers.

| Column | What it does |
|---|---|
| AI | Talk with AI. Switch sessions and keep the history |
| Client search | Search the notes accumulated on your machine across servers ([Finding notes](/en/docs/guide/search)) |
| Memos (メモ) | Local notes. Saved as Markdown files, so you can open them from Obsidian and others |
| MFM editor (MFM エディター) | Write MFM while checking it with the same renderer as the deck, then send it to the post form. Comes with samples and a function reference |
| Themes / Plugins / Widgets / Skills / Queries | List what you have installed, turn it on or off, and see its history (creating and editing need developer mode) |

### Columns for developers

Columns whose entrance appears in [developer mode](/en/docs/#developer-mode).

| Column | What it does |
|---|---|
| Stream (ストリーム) | Watch the WebSocket traffic with the server in real time |
| API console / API docs | Call the Misskey API directly and look up its spec |
| Scratchpad (スクラッチパッド) | Run throwaway AiScript |
| Tasks (タスク) | Run the tasks declared in `tasks.json5` |

"Stream" shows exactly what is flowing behind the scenes in Misskey. Use it to narrow down odd behavior, or to learn how things work.

## Window types

You do not "add" windows yourself; they open in response to what you do.

- **Details** — note details, profiles, follow lists
- **Tools** — adding an account, settings, the various editors
- **Inspector** (developer mode) — raw data (Raw JSON) of notes and notifications. Some sensitive fields, such as tokens in notifications, are masked and shown only when you ask

::: tip When there are too many columns to fit
The more columns you line up, the narrower they get. It is more comfortable to split them into [profiles](/en/docs/deck/profiles) per purpose and switch between them.
:::
