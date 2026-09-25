---
sourceHash: fd6c7e9c5a34
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

Merged views (cross-account) are supported for **notifications, search, chat, mentions, direct messages and follow requests**. If you use several servers and do not want to miss notifications, placing a single notifications column set to "All accounts" is the easy way.

## Column types

The "Add column" dialog is split into three groups.

### Account

Things tied to your own account.

Timeline / Notifications / Drive / Follow requests / Lists / Antennas / Favorites / Clips / Mentions / Direct / Chat / Achievements

### Server

Things that show information from the server side. Many of them can be viewed without logging in.

Server info / About Misskey / Custom emoji / Ads / Explore / Announcements / Search / Lookup / Channels / Roles / Gallery / Misskey Play / Pages / Users / Charts / Federation

### Tool columns

Work columns unique to NoteDeck. Some of them have nothing directly to do with Misskey servers.

| Column | What it does |
|---|---|
| AI | Talk with AI. Switch sessions and keep the history |
| Memo (メモ) | Local notes. Saved as Markdown files, so you can open them from Obsidian and others |
| Tasks (タスク) | Manage things to do |
| Scratchpad (スクラッチパッド) | A throwaway text area |
| Themes / Plugins / Widgets / Skills / Queries | List what you have installed, turn it on or off, and edit it |
| Stream (ストリーム) | Watch the WebSocket traffic with the server in real time |
| API console / API docs | Call the Misskey API directly and look up its spec |

"Stream" shows exactly what is flowing behind the scenes in Misskey. Use it to narrow down odd behavior, or to learn how things work.

## Window types

You do not "add" windows yourself; they open in response to what you do.

- **Details** — note details, profiles, follow lists
- **Inspector** — raw data (Raw JSON) of notes and notifications. Sensitive fields such as API keys are masked automatically and shown only when you ask
- **Tools** — login, the various editors, settings

::: tip When there are too many columns to fit
The more columns you line up, the narrower they get. It is more comfortable to split them into [profiles](/en/docs/deck/profiles) per purpose and switch between them.
:::
