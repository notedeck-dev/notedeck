---
sourceHash: 52adab180e6f
---

# Resident core (notecored)

NoteDeck's "core" is the part that talks to Misskey, stores your data and runs the AI. By default it is embedded in the app and starts and stops with it. **notecored** runs the same core as a systemd user service, so notifications and HEARTBEAT keep going after the app closes.

::: warning Linux only
Running the core on the same device (this stage) is Linux only, on systems with a systemd user session. macOS / Windows, and connecting to a notecored on another device, come in later stages. Android / iOS cannot keep a process alive outside the app, so they will connect to a notecored on a desktop or server in the future.
:::

## What changes

- **The data is the same.** notecored uses the same data directory as the app; switching changes who runs the core, not where the data lives. A lock keeps two processes from touching the same data at once
- **Secrets move.** The app keeps your Misskey tokens and connection secrets in the OS keychain; notecored keeps them in an encrypted file. Switching copies them through a migration package, and switching back takes them back. This is weaker protection than the OS keychain, and the confirmation says so
- **The version must match the app.** The app refuses to connect to a notecored of a different version, checks before switching, and asks you to update if they differ

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

1. Turn on **developer mode** in the settings (switching to the resident core is a developer entry point for now)
2. Open **Core** in the settings menu. If notecored is found, its path and version are shown
3. Press **Switch to resident**, read the confirmation and continue. It reports how many secrets were exported and asks you to restart
4. **Restart** the app. On start it imports the secrets, enables the resident service and connects

Once switched, a server mark appears at the top of the navbar. It opens Core, where you can see the connection and what notecored reports about itself.

To go back, use **Go back to embedded** on the same window, confirm, and restart. The secrets return to this app's store, and once all of them are back the copy held by notecored is deleted.

## Requirements

- A running systemd **user session** (`systemctl --user status` works). On WSL2, enable systemd in `/etc/wsl.conf`
- `XDG_RUNTIME_DIR` is set (it holds the socket and the migration package)
- To keep it running after you log out, set `loginctl enable-linger` (the app does not do this for you)

## Troubleshooting

- **Logs**: `journalctl --user -u notecored -e` (Core has a button that copies the command). Without a journal, they go to `logs/notecored.log` in the data directory
- **The switch does not complete**: Core shows the reason. If the migration package is gone (for example the temporary directory was cleared by logging in again), choose "Switch again" or "Stop and stay embedded"
- **Version mismatch**: update notecored to the app's version before switching
- **notecored stops by itself**: for states a restart cannot fix (another process owns the data directory, the database is newer than notecored, no runtime dir, the secret key cannot be read) it exits with a dedicated code and systemd does not restart it. The reason is in `journalctl`

## Commands

```bash
notecored run                 # run in the foreground (same data directory as the app; close the app first)
notecored status              # what the running notecored reports
notecored service install     # prepare the user unit (does not enable or start)
notecored service enable      # enable + start
notecored service status | stop | restart | uninstall
notecored migrate status      # whether secrets and a migration package exist
notecored run --api           # also serve the public API (REST + SSE on localhost)
```

If you run or enable it by hand while the app is still configured as "embedded", the app tries to start its embedded core and the lock collides. The app's switch keeps both sides in step, so keep manual use to checks and the `--api` case.
