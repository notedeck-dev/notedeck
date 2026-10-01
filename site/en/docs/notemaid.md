---
sourceHash: 0af060a8bcf3
---

# The AI process (notemaid)

NoteDeck's AI (the agent loop and HEARTBEAT) runs in a separate process, **notemaid**. Fetching timelines, archiving, subscriptions and the deck run inside the app; notemaid holds only the AI. Normally you never notice it: the app starts the bundled notemaid as a child process when it launches and it exits with the app.

## Two ways to run it

| Form | Who starts it | What you get |
|---|---|---|
| Default (child process) | The app | No setup. Starts and stops with the app. If you close the window to the tray, the AI stays alive |
| Resident | A login task of your OS (the toggle in AI settings) | HEARTBEAT keeps going after you quit the app. The next launch connects to it automatically |

Both run on the same device. There is no way to connect to a notemaid on another device or your own server: it would give you only what the resident form already gives (the rounds keep going), at the cost of authentication and key handling.

At startup the app first checks whether a resident notemaid is there, connects if so, and otherwise starts a child process. In every form your data (archive, subscriptions, deck) stays on the device, and notemaid uses the app settings and the tokens of the same accounts from the OS keychain (it never opens the app database). The version has to match the app (if not, AI settings shows why).

## Making it resident

Only needed if you want HEARTBEAT to keep running after you quit the app completely. Turn on "Keep running after the app exits" under **AI settings** → HEARTBEAT: it registers a login task with your OS (a systemd user unit on Linux, a LaunchAgent on macOS, the Run registry key on Windows) and switches over on the spot, no restart needed. Turning it off removes the task and goes back to the child process.

The AppImage mounts at a different path every launch, so the toggle is not available there. Put the standalone binary from Releases somewhere on your PATH and register it by hand.

```bash
notemaid service install    # write the login task
notemaid service enable     # register and start
```

On Linux, to keep it running after logout, set `loginctl enable-linger`. Stop it with `notemaid service stop`, or `uninstall` if you no longer need it.

If you only want to connect to the resident one (never start a child process), set `client.json5` in the settings folder to `{ backend: "resident" }`. To always run in-process instead (development, troubleshooting), use `{ backend: "embedded" }`. The default is `auto`.

## Requirements

- For resident mode on Linux, a systemd **user session** must be running (`systemctl --user status` works). On WSL2 enable systemd in `/etc/wsl.conf`
- The resident socket needs `XDG_RUNTIME_DIR`. The child process works without it (it uses the temp directory)

## Troubleshooting

- **Logs**: the child process and the resident one on macOS / Windows write to `logs/notemaid.log` in the data directory; on Linux the resident one goes to `journalctl --user -u notemaid -e`
- **Version mismatch**: update notemaid to the same version as the app. The child process is bundled, so it always matches
- **notemaid stops by itself**: for states a restart cannot fix (another notemaid owns the data directory, the secret key cannot be read) it exits with a dedicated code and systemd does not restart it. The reason is in the log

## What notemaid owns

notemaid writes only its own things inside the settings folder: the AI's personality and memory (`notemaid/`), AI sessions (`sessions/`), memos (`memos/`), skills (`skills/`) and the AI settings (`ai.json5`). It never opens the app database. You read and edit the personality and memory under "AI personality and memory" in the AI settings; the file list is in [Settings files](/en/docs/config/files).

## Commands

```bash
notemaid run                 # run in the foreground
notemaid status              # status of the running notemaid
notemaid service install     # write the login task (no start)
notemaid service enable      # register and start
notemaid service status | stop | restart | uninstall
```
