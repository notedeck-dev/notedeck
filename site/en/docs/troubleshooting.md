---
sourceHash: 7561b4109a7c
---

# Troubleshooting

## Cannot log in

Make sure you entered only the server's host name (no `https://`, in the form `misskey.io`).

Authentication goes through your browser. If the default browser does not open, or you are not sent back to NoteDeck after allowing, restart the app once and try again.

## Timelines stopped updating

NoteDeck stays connected to servers over WebSocket. Right after the connection drops or the machine wakes from sleep, reconnecting takes a moment.

If nothing flows in after waiting a while:

1. Reload the column manually
2. Open a **Stream** (ストリーム) column and check the connection state and the events flowing through

The Stream column shows the actual traffic as it is, so you can tell whether "the server is not sending it" or "the app is not showing it".

## Notes do not show up or suddenly vanished

There are several reasons a note may not be shown.

- **It is caught by a mute** — check your word, user, instance and renote mute settings
- **A column query is narrowing it down** — check the query in effect from the column's filter menu
- **The author was suspended** — notes by users suspended on the server are hidden. They come back automatically if the suspension is lifted

NoteDeck does not delete data; it only decides whether to show it. Lift the mute and the hidden notes come back as they were.

## The layout looks broken

If you write `custom.css`, first empty it and check. When an app update changes the internal structure, CSS you wrote before can hit unintended places.

A theme can also be the cause. Switch back to the default theme to narrow it down.

## It feels slow

- Reduce the number of open columns (split them by purpose with [profiles](/en/docs/deck/profiles))
- Switch [how light it runs](/en/docs/guide/appearance#choosing-how-light-it-renders) to a low-memory preset
- Close image-heavy columns

## The AI does not respond

- Is the API key valid, and is there balance left with the provider?
- Is a provider selected in the AI settings?
- Is a needed action forbidden by permissions (or did you close the confirmation dialog)?

If HEARTBEAT fails repeatedly, it stops automatically and shows a warning. Fix the cause, then turn it on again.

## I want to reset settings to defaults

Delete the relevant [settings file](/en/docs/config/files) and it is recreated with defaults on the next launch. To reset everything, delete the whole settings folder.

::: warning Back up first
Deleting the settings folder also erases your accumulated note cache and memos. Take a [backup](/en/docs/config/backup) first.
:::

## If it still does not work

Report it on [GitHub Issues](https://github.com/notedeck-dev/notedeck/issues). The following makes the cause easier to track down.

- OS and app version
- What you did to make it happen
- Logs (**File → Open log folder** (ファイル → ログフォルダを開く))
