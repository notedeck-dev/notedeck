---
sourceHash: 111a0f454c00
---

# Extending from the store

Install things other people made from [misstore](https://store.notedeck.io) in one click. You can open it straight from a column.

## What you can install

| Type | What it does |
|---|---|
| **Themes** | Change the color scheme |
| **Plugins** | Add features, such as note menu items or post processing |
| **Widgets** | Small display components |
| **Queries** | [Conditions that narrow a column's view](/en/docs/guide/search#narrowing-each-column-s-view) |
| **Skills** | Instructions for the AI to learn |

Plugins and widgets are written in **AiScript**, the same as in Misskey. What you know about plugins for upstream Misskey carries over as is.

## Turning things on and off

What you install is listed and managed in its own column (Themes / Plugins / Widgets / Skills / Queries).

Plugins can be turned **on or off per account**, so a plugin you only want on a certain server can be enabled without affecting other accounts.

## Writing your own

An editor with live preview is built in, and what you write runs on the spot. You are free to keep it local without publishing it to the store.

Register a command in AiScript with `Nd:register_command`, and it can be called from all of these:

- The command palette
- Keybindings
- AI tools (you can ask the AI to "use this")
- The local API (from external apps and CLIs)

In other words, write it once and use it from any entrance.

For how to write them, see [Building extensions](/en/docs/dev/).

## How it stays safe

What plugins and widgets can do is limited by permissions. High-impact actions such as posting or account operations show a confirmation dialog.

Before installing something you do not trust, check what it asks for. Permissions are managed in `permissions.json5` (see [Settings files](/en/docs/config/files)) and cannot be rewritten by plugins.
