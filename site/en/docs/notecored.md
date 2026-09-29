---
sourceHash: 26466340ee24
---

# Resident core (notecored)

NoteDeck's "core" is the part that talks to Misskey, stores your data and runs the AI. By default it is embedded in the app and starts and stops with it. **notecored** runs the same core as a systemd user service, so HEARTBEAT keeps going after the app closes.

::: info notecored is being replaced by notemaid
Going forward only the AI (agent loop, HEARTBEAT, delivery of results) stays resident, under the name **notemaid**. The AI runs as a separate process that the app starts by itself with no setup; keeping it running after the app closes, or placing it on your own server, are optional. Your data stays on the device as before, and the core switch and the secret migration go away. This page describes the current notecored ([#1106](https://github.com/notedeck-dev/notedeck/issues/1106)).
:::

::: warning Linux only
Running the core on the same device (this stage) is Linux only, on systems with a systemd user session. macOS / Windows, and connecting to a notecored on another device, come in later stages. Android / iOS cannot keep a process alive outside the app, so they will connect to a notecored on a desktop or server in the future.
:::

## What changes

- **Only the AI stays resident.** The agent loop and HEARTBEAT run in notecored, and the app relays AI calls to it. Fetching timelines, archiving, subscriptions and the deck keep running inside the app; notecored does not hold them
- **The data is in the same place.** notecored uses the same data directory as the app and reads the account credentials and the cache. Nothing moves
- **The version has to match the app.** A notecored of a different version is not connected (the status view shows why)

## Install

Install the same version as the app.

::: code-group

```bash [AUR (Arch Linux)]
yay -S notecored-bin
```

```bash [Nix (profile)]
nix profile add 'github:notedeck-dev/notedeck#notecored'
```

```nix [home-manager]
# with notedeck added to your flake inputs
imports = [ notedeck.homeManagerModules.notecored ];
services.notecored.enable = true;
```

```bash [deb / tarball]
# the app's .deb and tarball ship notecored of the same version
notecored --version
```

:::

If you use the AppImage, put the standalone binary from Releases (`notecored-<version>-linux-amd64` and so on) somewhere on your PATH.

## Switching

Switching is manual for now (the app starting it as a child process, and a toggle in settings, come in later stages).

1. Run `notecored service enable` to enable the user service
2. In the settings folder ("File → Open settings folder"), set `client.json5` to `{ backend: "resident" }`
3. Restart the app. **Core** in the settings menu shows the connection state, and a server mark appears at the top of the navbar

To go back, set `client.json5` to `{ backend: "embedded" }`, restart, and run `notecored service stop` (or `uninstall` if you no longer need it).

## Requirements

- A running systemd **user session** (`systemctl --user status` works). On WSL2, enable systemd in `/etc/wsl.conf`
- `XDG_RUNTIME_DIR` is set (it holds the socket)
- To keep it running after you log out, set `loginctl enable-linger` (the app does not do this for you)

## Troubleshooting

- **Logs**: `journalctl --user -u notecored -e` (Core has a button that copies the command). Without a journal, they go to `logs/notecored.log` in the data directory
- **Version mismatch**: update notecored to the app's version before switching
- **notecored stops by itself**: for states a restart cannot fix (another process owns the data directory, the database is newer than notecored, no runtime dir, the secret key cannot be read) it exits with a dedicated code and systemd does not restart it. The reason is in `journalctl`

## Commands

```bash
notecored run                 # run in the foreground (same data directory as the app; close the app first)
notecored status              # what the running notecored reports
notecored service install     # prepare the user unit (does not enable or start)
notecored service enable      # enable + start
notecored service status | stop | restart | uninstall
```

If `client.json5` on the app side is still `embedded`, the app keeps running the AI inside itself even while notecored is running (both only read the same data directory; they do not conflict).
