---
sourceHash: 0347f7c30fcd
---

# Backup

## What you want to protect

The data NoteDeck holds falls into two parts.

| | Contents | Where |
|---|---|---|
| **Settings and records** | Column layout, themes, keybindings, plugins, memos, the AI's personality and memory and so on | [`config/` and `data/`](/en/docs/config/files#where-settings-live) in the app data folder |
| **Note cache** | Accumulated notes that flowed past, account information | `notecli.db` directly in the app data folder |

Access tokens and AI API keys are in neither (they are in the OS keychain). You need to log in again on the new machine.

## Taking one from inside the app

**Backup** (バックアップ) in the settings menu writes out the note cache and the settings together, and reads them back. It goes to `notedeck/backup/<timestamp>/` in your downloads folder, and older ones are deleted beyond a fixed number ("Open backup folder" opens the location). The note cache is copied in a consistent state even while the app is running, and credentials are always stripped out.

You can ask the AI to do the same (the capability `backup.create`; because of its impact it is off by default, and always refused from outside).

## Backing up settings

Settings support export and import. Load the exported file on another machine to reproduce the same environment.

It covers the contents of `config/` listed in [Settings files](/en/docs/config/files#what-is-in-config) plus, from `data/`, the memos, the AI conversations and the three Markdown files of personality and memory. This PC's state (`state/`: window positions, consents, tutorial progress and so on) and the edit history are not included, nor are the values plugins and widgets keep with `Mk:save`.

If you want to keep settings in step with another PC, [managing them with Git](/en/docs/config/sync) suits better than backups.

Importing overwrites the current settings and restarts. Items with identical contents are skipped, name collisions go in under a different name, and items with invalid names are not imported. Whether to replace the personality and memory is confirmed separately.

## Backing up notes

Using the in-app backup is the reliable way. To do it by hand, **just copy** `notecli.db`. It is a SQLite file, so that single file holds all the notes you have accumulated plus your account information. Quit the app before copying by hand. Copying while it runs can catch it in the middle of a write.

::: warning Deleted means gone
Uninstalling the app leaves settings and cache behind, but deleting the whole app data folder also erases the notes you accumulated. You can only fetch again what still exists on the server.
:::

## Data on the Misskey side

Backing up data stored on the server — your own posts, follows, favorites and so on — is a Misskey feature. Export it from your server's settings page. NoteDeck's backup only saves "the state of this device".
