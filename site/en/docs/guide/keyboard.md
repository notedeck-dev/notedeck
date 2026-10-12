---
sourceHash: 810e142ffac4
---

# Keyboard

NoteDeck is built so you can use it without a mouse. When in doubt, open the **command palette**.

## Command palette

Open it with `Ctrl+K` (or `/` or `?` when you are not typing text). Adding columns, switching accounts, opening settings, posting — find the main actions by name here and run them.

Commands from plugins and from AiScript you wrote yourself show up in the same palette.

## Main shortcuts

Keys come in two kinds. **Keys with modifiers** work everywhere in the app; **single keys** do not work while you are typing text (so they do not get in the way).

| Action | With modifiers | Single key |
|---|---|---|
| Command palette | `Ctrl+K` | `/` `?` |
| Search | `Ctrl+Shift+F` | `s` |
| Notifications | — | `i` |
| Post | `Ctrl+Shift+N` | `p` `n` |
| Add column | `Ctrl+Shift+A` | — |
| Remove column | `Ctrl+W` | — |
| Go to a column | `Ctrl+1` to `Ctrl+9` | `Shift+H` / `Shift+L` for left / right |
| Switch profile | `Alt+1` to `Alt+9` | `g` for the menu |
| Move up / down between notes | — | `j` / `k` |
| Reply / react / renote a note | — | `r` / `e` / `q` |
| Toggle sidebar | `Ctrl+\` | — |
| Settings / tutorial | `Ctrl+,` / `F1` | — |
| Zoom in / out / reset | `Ctrl++` / `Ctrl+-` / `Ctrl+0` | — |
| Boss Key (hide the window) | `Ctrl+Shift+B` | — |
| Quick note (post from anywhere) | `Ctrl+Alt+N` | — |

`Ctrl+Shift+B` (Boss Key) and `Ctrl+Alt+N` (quick note) are **system-wide hotkeys**. They work even when NoteDeck is in the background or you are using another app.

## Assigning your own keys

Every keybinding can be changed. Like `keybindings.json` in VS Code, you override the default bindings on your side. The settings are saved in `keybinds.json5`.

Each shortcut has a scope.

- `global` — always active inside the app. Use it for keys with modifiers
- `body` — inactive while typing text. Use it for single keys
- `os-global` — active across the whole OS (desktop only, modifiers required). The "System-wide" (OS 全体) toggle in the keybinding settings lets you assign it to any command

Setting a single key to `global` stops you from typing it, so give keys without modifiers the `body` scope.

For where the file lives and how to edit it, see [Settings files](/en/docs/config/files).
