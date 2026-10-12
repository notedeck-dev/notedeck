---
sourceHash: 94a1221efabb
---

# Troubleshooting

When something goes wrong, first look at "Self-diagnosis" (自己診断) in the **About NoteDeck** window. It gathers stream disconnections, the previous abnormal exit, the state of the AI's separate process and repeated HEARTBEAT failures in one place. "Copy info" (情報をコピー) gives you the details for a report.

## Cannot log in

Enter the server's host name (in the form `misskey.io`; a leading `https://` or trailing `/` is stripped if present).

Authentication goes through your browser. After allowing in the browser, it is not complete until you press "I've authorized" (認証しました) on the NoteDeck side. If the default browser does not open, or you lose track halfway, "Start over" (やり直す) takes you back to the beginning.

On Linux without Secret Service (GNOME Keyring and so on), a warning says so at startup and tokens fall back to an encrypted file.

## Timelines stopped updating

NoteDeck stays connected to servers over WebSocket. Right after the connection drops or the machine wakes from sleep, reconnecting takes a moment.

If nothing flows in after waiting a while:

1. Check that **offline mode** or realtime mode has not been switched off (you can also toggle them from the tray menu)
2. Check whether the "while the window is hidden, pauses timeline subscriptions" setting is in effect
3. Reload the column manually
4. Look at the connection state in the About self-diagnosis. To dig further, open a **Stream** (ストリーム) column in [developer mode](/en/docs/#developer-mode) and check the events flowing through

The Stream column shows the actual traffic as it is, so you can tell whether "the server is not sending it" or "the app is not showing it".

## Notes do not show up or suddenly vanished

There are several reasons a note may not be shown.

- **It is caught by a mute** — check your word, user, instance and renote mute settings
- **A column query is narrowing it down** — check the query in effect from the column's filter menu
- **The author was suspended** — notes by users suspended on the server are hidden. They come back automatically if the suspension is lifted

NoteDeck does not delete data; it only decides whether to show it. Lift the mute and the hidden notes come back as they were.

## Images do not load or external integrations do not work

If a message at startup says "the image relay and external integrations (HTTP API) are unavailable", another app grabbed the local port NoteDeck uses before it did. Quit that app or free the port, then start NoteDeck again.

## The layout looks broken

If you write `custom.css`, first empty it and check. When an app update changes the internal structure, CSS you wrote before can hit unintended places.

A theme can also be the cause. Switch back to the default theme to narrow it down.

## It feels slow

- Reduce the number of open columns (split them by purpose with [profiles](/en/docs/deck/profiles))
- Switch [how light it renders](/en/docs/guide/appearance#choosing-how-light-it-renders) to a low-memory preset
- Close image-heavy columns

## The AI does not respond

- Is the API key valid, and is there balance left with the provider?
- Is a provider selected in the Agent settings?
- Is a needed action forbidden by permissions (or did you close the confirmation dialog)?
- Is the AI's separate process running? The About self-diagnosis shows reasons such as the child process having exited, a version mismatch, or the resident one not running. For details, see [The AI process](/en/docs/notemaid#troubleshooting)

If HEARTBEAT fails repeatedly, it stops automatically and shows a warning. Fix the cause, then turn it on again.

## I want to reset settings to defaults

Delete the relevant [settings file](/en/docs/config/files) and it is recreated with defaults on the next launch. To reset everything, delete the whole settings folder.

::: warning
Deleting the settings folder also erases your memos, the AI's personality and memory, AI sessions, skills, plugins and themes. Take a [backup](/en/docs/config/backup) first. The accumulated notes (`notecli.db`) live in the parent of the settings folder, so they remain.
:::

## If it still does not work

Report it on [GitHub Issues](https://github.com/notedeck-dev/notedeck/issues). The following makes the cause easier to track down.

- OS and app version
- What you did to make it happen
- The output of "Copy info" in the About self-diagnosis (after an abnormal exit, "Copy the diagnostic log below and report it")
- Logs (**File → Open log folder** (ファイル → ログフォルダを開く). The AI process's logs are under `logs/` in the app data folder)
