---
sourceHash: 19e1563653cc
---

# First-run setup

On first launch, with no account added yet, a tutorial starts. Follow it and you will go from logging in to arranging your deck.

If you stop halfway, whatever you set up so far is kept. You can resume later with "Show tutorial" (チュートリアルを見る) in the [About window](#redo-the-tutorial).

## 1. Add an account

In the login window, enter the host name of a Misskey server (for example `misskey.io`) and authenticate. Your browser opens the server's authorization page; once you allow it, you are sent back to NoteDeck.

Your login (access token) is stored in the OS keychain.

- macOS → Keychain Access
- Windows → Credential Manager
- Linux → Secret Service (GNOME Keyring and so on)

Tokens are never written in plain text into the app's settings files.

::: tip Multiple accounts
Repeat the same steps to add accounts on other servers. Add as many as you like, and choose which account each column runs as.
:::

## 2. Make the deck your own

NoteDeck is used by lining up columns. On first launch the deck already has columns, all of them set to "All accounts" (全アカウント) — columns that show every account you have added together. The more accounts you add, the more servers flow into the same column.

Use them as they are or remove them. From a column's header you can reorder, resize and remove it, and "Add column" (カラム追加, +) lets you add the notifications, search, chat or other columns you need. For what can go where, see [Columns and windows](/en/docs/deck/columns).

Even if you remove everything, "Start with the default layout" (既定の構成で始める) on the empty deck brings back the initial arrangement.

## 3. (Optional) Connect AI

To use the AI features, register your own API key. Everything else works without it.

1. In the connections window, register an API key for a provider such as Anthropic or OpenAI
2. In the AI settings, choose the connection you registered as the AI provider
3. Open an AI column from the AI button in the sidebar

API keys are stored in the OS keychain and never written into settings files. For details, see [Using AI](/en/docs/guide/ai).

## Redo the tutorial

You can start over at any time. Open the **About window** and choose "Show tutorial" (チュートリアルを見る). Steps you have already finished are skipped automatically.
