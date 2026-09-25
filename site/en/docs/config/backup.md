---
sourceHash: 3d2185832d46
---

# Backup

## What you want to protect

The data NoteDeck holds falls into two parts.

| | Contents | Where |
|---|---|---|
| **Settings** | Column layout, themes, keybindings, plugins, memos and so on | [Settings folder](/en/docs/config/files#where-settings-live) |
| **Note cache** | Accumulated notes that flowed past, account information | `notecli.db` |

## Backing up settings

Settings support export and import. Load the exported file on another machine to reproduce the same environment.

It covers the files and folders listed in [Settings files](/en/docs/config/files#what-is-written-where). **API keys and access tokens are not included** (they are in the OS keychain). You need to log in again on the new machine.

## Backing up notes

**Just copy** `notecli.db`. It is a SQLite file, so that single file holds all the notes you have accumulated plus your account information.

Quit the app before copying. Copying while it runs can catch it in the middle of a write.

::: warning Deleted means gone
Uninstalling the app leaves settings and cache behind, but deleting the whole settings folder also erases the notes you accumulated. You can only fetch again what still exists on the server.
:::

## Data on the Misskey side

Backing up data stored on the server — your own posts, follows, favorites and so on — is a Misskey feature. Export it from your server's settings page. NoteDeck's backup only saves "the state of this device".
