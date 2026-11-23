<!-- sourceHash: a81b331f936d -->
# Privacy Policy

NoteDeck is an integrated environment (IDE) for Misskey and other decentralized social networks. It runs on desktop (Windows / macOS / Linux) and Android. This document states how NoteDeck handles user data.

This is a translation. The Japanese version ([PRIVACY.md](https://github.com/notedeck-dev/notedeck/blob/main/PRIVACY.md)) is the authoritative text.

## Basic policy

The developers of NoteDeck do not operate any server that receives users' data. There is no account registration for NoteDeck itself, and no usage data is collected. User data is, as a rule, stored only on the device.

Communication with other systems is limited to what is listed under "Network communication", and in every case the device connects directly to the other party. The main ones are the Misskey servers the user has logged in to and the AI providers the user has configured.

What the developers publish is the official site (`notedeck.io`) and the store for distributed items (`store.notedeck.io`). The app only downloads items from them and never sends the user's account or usage to them.

## Credentials stored in the OS keychain

Sensitive credentials are stored in the operating system's keychain. Where a keychain is available, they are not stored in settings files or in the SQLite database.

**Exception where no keychain is available**: in environments where the OS has no keychain, or where its contents are lost on reboot (for example on Linux when neither Secret Service nor the encrypted file described below can be used), Misskey access tokens are also kept unencrypted in files on the device (`notecli.db` and `state/secrets/`) so that you stay logged in. These files are made readable by their owner only.

- **Misskey access tokens** (per server / per account)
- **AI provider API keys** (through the Secret Vault, stored per connection)

Where they are stored:

| OS | Backend |
|---|---|
| macOS | Keychain Access |
| Linux | Secret Service (gnome-keyring / KWallet and so on). Where that is unavailable (servers / WSL2 / containers), an encrypted file (`~/.local/share/notecli/secrets.enc`, with the key in a separate directory, `~/.config/notecli/secret.key`) |
| Windows | Credential Manager |
| Android | Encrypted with a key in the Android Keystore and kept in the app's private storage (excluded from off-device backups) |

The encrypted file on Linux is not isolated from other processes of the same OS user as strongly as an OS keychain is. The key is kept outside the data directory so that it does not end up in a backup or copy of the data directory alone.

## Data stored locally

The following is stored in the app data folder (`$APP_DATA_DIR`). You can find the location of the settings files from "File → Open settings folder".

| File / folder | Contents |
|---|---|
| `notecli.db` (SQLite) | The list of connected accounts (the tokens themselves are in the keychain), a cache of notes, notifications and user information, the FTS5 full-text search index, the chat cache |
| `config/settings.json5` | User settings such as the selected theme and mode |
| Other settings files in `config/` | Key bindings, navbar, performance, post form, tasks, permissions, custom CSS, AI settings (non-secret) |
| `config/connections.json` | Definitions of connections to external services (the secrets themselves are in the keychain) |
| `config/profiles/` | Deck profiles (column layout and so on) |
| `config/themes/` | User-made themes |
| `config/plugins/` | Plugins and their settings |
| `config/widgets/` | Widgets |
| `config/skills/` | AI skills |
| `config/snippets/` | Snippets |
| `config/queries/` | Column queries |
| `data/memos/` | AI memos |
| `data/sessions/` | AI chat session history |
| `data/notemaid/` | The AI's persona and memory (SOUL.md / USER.md / MEMORY.md and so on) |
| `state/` | State that belongs to this device only (window placement, connection consents, skipped confirmations, edit history, records of AI runs in progress and so on) |
| `state/notify_cursor.json` (Android) | The position of the last notification turned into an OS notification (per account), so that the same notification is not announced twice. Excluded from off-device backups |
| `cache/` | A cache of displayed images, sound effects and emoji |

`config/` holds settings, `data/` holds the user's records (which can include the text of other people's posts), `state/` holds state that belongs to this device only, and `cache/` can be deleted freely. Right after updating from an older version, settings and records still sit together under `notedeck/` until the first launch moves them into this layout.

In addition, a daily-rotated application log is written to the OS log folder, and if the app crashes, information about the crash is recorded locally. Neither is sent automatically.

All of this stays on the user's machine, and the developers of NoteDeck have no means of accessing it.

On Android, if the OS backup (Google backup / device-to-device transfer) is enabled, the OS stores and transfers the settings part of NoteDeck's data directory. Account information and the note cache (`notecli.db`), this-device-only state, the cache and the logs are included in neither. Memos, AI chat session history and the AI's persona and memory are included only in direct device-to-device transfer (Android 12 and later), not in cloud backups.

## Microsoft Store version (Windows)

The version installed from the Microsoft Store differs from the directly distributed version (installer / winget / zip) as follows.

- **Data location**: the app's data, logs and WebView data are kept in a location private to the package (under `%LOCALAPPDATA%\Packages\<package name>\LocalCache\`). It does not use the data of the directly distributed version
- **Uninstalling**: the OS removes this private location when the app is uninstalled
- **Credentials**: stored in Credential Manager under the name `notedeck-msstore`, separate from the directly distributed version (`notedeck`). Credential Manager entries remain after uninstalling (this is how the OS works). To remove them, log out of the accounts and delete the connections before uninstalling, or delete the `notedeck-msstore` entries in Credential Manager
- **Updates**: the app does not check for updates. Installation and updates are performed by the Microsoft Store, and are handled according to Microsoft's privacy policy

## Network communication

NoteDeck communicates with other systems as listed below. In every case the user's device connects directly to the other party, and nothing is relayed by the developers of NoteDeck. The other party learns the IP address the connection comes from.

1. **Misskey servers** — REST / WebSocket streaming, fetching images. On Android, the app also connects to the same servers periodically over REST while it is closed, to check for notifications
2. **Media in notes and profiles** — images, video, audio and custom emoji are fetched from the servers that host them (which can be a different server or storage service from the one you logged in to)
3. **AI providers** — only when AI chat is used. Compatible with the Anthropic Messages API / OpenAI Chat Completions API. When a local CLI is used as the AI, that CLI communicates with its own provider
4. **External services the user has registered as connections** — services the user registered themselves, such as a translation API, are contacted only when that feature is used
5. **Update check** — `https://github.com/notedeck-dev/notedeck/releases/latest` (Tauri Updater). The Microsoft Store version does not do this
6. **OGP fetching** — fetching OGP information for URLs in notes (can be turned off in settings). For some sites, the preview connects to that site's public API or embedded player
7. **Store** — the listing and files of plugins, themes, widgets and skills are fetched from `store.notedeck.io` (when you open the store, install an item, or check for updates). This only downloads; no account information is sent
8. **Pets** — the pet listing and images are fetched from `petdex.dev` (when choosing a pet)
9. **Icons, fonts and logos** — icons for AI connection templates (`icons.duckduckgo.com`), web fonts for a CSS preset the user selected (Google Fonts and others), and logos and avatars shown in the "About Misskey" column (`misskey-hub.net` / GitHub)
10. **Communication performed by plugins and widgets** — plugins and widgets the user installed may communicate with other systems for their own features. The destinations depend on each item
11. **The built-in API documentation page** — when the developer-oriented API documentation is opened in a browser, a script for rendering it is loaded from `cdn.jsdelivr.net`
12. **Push notifications (Android, only when the user enables them per account)** — encrypted notifications arrive from the Misskey server through the push notification app the user installed (UnifiedPush) and its delivery server. NoteDeck has no relay server. The destination (endpoint) and the decryption key are kept on the device (in the keychain and the app's private storage) and excluded from off-device backups. As part of the registration procedure, the destination, the public key used for encryption and the shared authentication secret (auth) are temporarily written to that account's registry on the Misskey server (NoteDeck's own area: other apps cannot read it, and the account owner can see it in the Web UI). When registration completes, is redone, or is cancelled, they are overwritten with a marker that contains no secret. On cancelling, an unsubscribe request is sent to the Misskey server

### Permissions requested on Android

- **Network** — for the communication listed above
- **Notifications** — to announce new activity through OS notifications. It is requested, with an explanation, after the first account is added. The app works without it

NoteDeck does not request access to location, contacts, the camera, the microphone or all files on the device. Attaching an image or a file goes through the OS picker, so the app receives only the files you chose.

### Communication NoteDeck does not perform

- ❌ Telemetry / usage statistics
- ❌ Automatic crash report submission
- ❌ Advertising
- ❌ Third-party analytics (Google Analytics and the like)
- ❌ Sending user data to the developers

## How AI chat handles data

When you use AI chat, the messages you enter and the context you allowed through capabilities are sent to the AI provider you selected.

- **Destination**: the AI provider the user registered in the Vault
- **Retention**: follows the AI provider's privacy policy (the developers of NoteDeck keep no record)
- **When the HEARTBEAT daemon is used**: data is sent to the AI provider periodically according to the configured skill (disabled by default)
- **AI session history**: stored locally in the `sessions/` folder. Actual token and API key values, and strings that look like keys, are replaced with `[redacted:…]` before saving and do not remain in logs either

## Deleting data

- **Per account**: account menu → Log out → "Delete everything" removes the cache, the token and related data. That account's token in the OS keychain is removed as well
- **AI API keys and secrets of external services**: deleting a connection also removes its secret from the OS keychain
- **Everything**: delete the settings folder and its parent, the app data folder. **Credentials in the OS keychain live outside these folders, so this alone does not remove them.** Either do the two steps above first (log out of the accounts and delete the connections), or delete the `notedeck` entries (for the Microsoft Store version, the `notedeck-msstore` entries) in your OS's keychain manager. If the encrypted file is in use on Linux, also delete `~/.local/share/notecli/secrets.enc` and `~/.config/notecli/secret.key`
- **Uninstalling**: follow the OS procedure for removing apps (on desktop, the settings folder is left for the user to delete separately; for the Microsoft Store version, see "Microsoft Store version (Windows)" above)
- **Android**: uninstalling the app, or clearing the app's storage in the OS settings, removes all data on the device
- **Data on Misskey servers**: posts and the accounts themselves are held by each Misskey server. The developers of NoteDeck do not have them and cannot delete them. Use that server's own features to delete them

## Sharing with third parties

The developers of NoteDeck do not provide user data to third parties. The developers do not have any user data in the first place.

## Open source

NoteDeck is published under the AGPL-3.0 license. The source code is available at [https://github.com/notedeck-dev/notedeck](https://github.com/notedeck-dev/notedeck).

## Contact

Please send questions about privacy through GitHub Issues: [https://github.com/notedeck-dev/notedeck/issues](https://github.com/notedeck-dev/notedeck/issues)

## Change history

See the change history at the end of the [Japanese version](https://github.com/notedeck-dev/notedeck/blob/main/PRIVACY.md).
