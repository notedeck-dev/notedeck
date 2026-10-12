---
sourceHash: 9bb3a7cf397f
---

# First-run setup

On first launch, with no account added yet, a tutorial starts. Follow it and you will go from logging in to checking your notifications.

If you stop halfway, whatever you set up so far is kept. You can resume later from [**Tutorial**](#redo-the-tutorial) (チュートリアル) at the top of the settings menu.

## 1. Add an account

In the "Add account" window, enter the host name of a Misskey server (for example `misskey.io`) and authenticate. Your browser opens the server's authorization page; once you allow it, come back to NoteDeck and press "**I've authorized**" (認証しました). If it fails, "Start over" (やり直す) takes you back to the beginning.

Your login (access token) is stored in the OS keychain.

- macOS → Keychain Access
- Windows → Credential Manager
- Linux → Secret Service (GNOME Keyring and so on; where there is none, it falls back to an encrypted file)
- Android → Android Keystore

Tokens are never written in plain text into the app's settings files.

::: tip Multiple accounts
Repeat the same steps to add accounts on other servers. Add as many as you like, and choose which account each column runs as.
:::

## 2. Make the deck your own

NoteDeck is used by lining up columns. On first launch the deck starts with a home timeline and a mentions column side by side, both set to "All accounts" (全アカウント) — columns that show every account you have added together. The more accounts you add, the more servers flow into the same column.

Use them as they are or remove them. From a column's header you can reorder, resize and remove it, and "Add column" (カラム追加, +) lets you add the notifications, search, chat or other columns you need. For what can go where, see [Columns and windows](/en/docs/deck/columns).

Even if you remove everything, "Start with the default layout" (デフォルトの構成で始める) on the empty deck brings back the initial arrangement.

## 3. (Optional) Connect AI

From here on you are outside the first-run tutorial. To use the AI features, register your own API key. Everything else works without it.

1. Under **Connections** (接続) in the settings menu, register an API key for a provider such as Anthropic or OpenAI
2. Under **Agent** (エージェント) in the settings menu, choose the connection you registered as the AI provider
3. Open an AI column from "More" (もっと) in the navbar (you can also put an AI button on the navbar)

API keys are stored in the OS keychain and never written into settings files. For details, see [Using AI](/en/docs/guide/ai).

## Redo the tutorial

Open **Tutorial** (チュートリアル) at the top of the settings menu and you get a checklist per category. Each item can be taken with "Start", "Continue" or "Again", and the ones you have already finished stay as they are. The "Building extensions" (拡張をつくる) category is unlocked by [developer mode](/en/docs/#developer-mode).
