---
sourceHash: 5dfb08d9fbf7
---

# The AI process (notemaid)

NoteDeck's AI (the agent loop and HEARTBEAT) runs in a separate process, **notemaid**. Fetching timelines, archiving, subscriptions and the deck run inside the app; notemaid holds only the AI. Normally you never notice it: the app starts the bundled notemaid as a child process when it launches and it exits with the app.

## Three ways to run it

| Form | Who starts it | What you get |
|---|---|---|
| Default (child process) | The app | No setup. Starts and stops with the app. If you close the window to the tray, the AI stays alive |
| Resident | A user service at login (systemd on Linux for now) | HEARTBEAT keeps going after you quit the app. The next launch connects to it automatically |
| Your own server | Started on the server | The AI runs regardless of your device's power (outbound connections come in a later stage) |

At startup the app first checks whether a resident notemaid is there, connects if so, and otherwise starts a child process. In every form your data (archive, subscriptions, deck) stays on the device, and notemaid uses the settings and credentials in the same data directory as the app. The version has to match the app (if not, **Core** in the settings menu shows why).

## Making it resident (Linux)

Only needed if you want HEARTBEAT to keep running after you quit the app completely.

```bash
notemaid service install    # write the user unit
notemaid service enable     # enable + start
```

You can use the binary bundled with the app (`/usr/bin/notemaid`, or the standalone one from Releases for the AppImage). To keep it running after logout, set `loginctl enable-linger`. Stop it with `notemaid service stop`, or `uninstall` if you no longer need it.

If you only want to connect to the resident one (never start a child process), set `client.json5` in the settings folder to `{ backend: "resident" }`. To always run in-process instead (development, troubleshooting), use `{ backend: "embedded" }`. The default is `auto`.

## Requirements

- For resident mode, a systemd **user session** must be running (`systemctl --user status` works). On WSL2 enable systemd in `/etc/wsl.conf`
- The resident socket needs `XDG_RUNTIME_DIR`. The child process works without it (it uses the temp directory)

## Troubleshooting

- **Logs**: the child process writes to `logs/notemaid.log` in the data directory; the resident one to `journalctl --user -u notemaid -e` (Core has a button that copies the command)
- **Version mismatch**: update notemaid to the same version as the app. The child process is bundled, so it always matches
- **notemaid stops by itself**: for states a restart cannot fix (another notemaid owns the data directory, the database is newer than notemaid, the secret key cannot be read) it exits with a dedicated code and systemd does not restart it. The reason is in the log

## Commands

```bash
notemaid run                 # run in the foreground
notemaid status              # status of the running notemaid
notemaid service install     # write the user unit (no enable / start)
notemaid service enable      # enable + start
notemaid service status | stop | restart | uninstall
```
