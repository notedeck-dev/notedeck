---
sourceHash: a2ca38dbc0ea
---

# Navbar

The tall bar on the left edge of the screen. Like the Activity Bar in VS Code, it holds **column toggle buttons**.

## It works as a toggle

Press a button and the matching column opens at the left end of the deck. Press it again to close it. Only one is open at a time; pressing another button swaps it. Buttons with unread items get a count badge.

When you just want a quick look at notifications or to open your memos, you can call up a column temporarily without keeping it in the deck. Things you want to watch all the time should be placed as regular columns.

By default the bar holds timeline, notifications, mentions, direct, messages, follow requests, server search, lookup and widgets as "All accounts" buttons. Anything not there (such as AI) can be opened from "More" (もっと).

## Changing the buttons

What goes on the navbar can be customized. From the Navbar item in the settings, you can add, remove and reorder buttons and insert separators.

You can also make buttons bound to a specific account, for example "notifications on misskey.io" and "notifications on another server" as separate buttons.

## Independent of profiles

The navbar layout is saved in `navbar.json5` and handled independently of [profiles](/en/docs/deck/profiles). Switching profiles does not change the navbar. The tab that edits the file as it is appears in [developer mode](/en/docs/#developer-mode).

::: tip Collapsing
Drag to change the navbar's width. As you make it narrower, it switches to icons only.

The width you choose is kept for the next launch. While the window is narrow it automatically shows icons only, and it returns to your width when you widen the window again.
:::
