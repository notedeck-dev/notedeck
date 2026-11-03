---
sourceHash: 7949c17317a2
---

# Using NoteDeck from other apps (Raycast / Stream Deck / Obsidian)

While it runs, the desktop version of NoteDeck keeps a local HTTP API open on `127.0.0.1:19820`, and it registers the `notedeck://` link scheme with the OS at install time. Those two entry points let other apps drive NoteDeck.

There are three official integrations. None of them adds anything to NoteDeck itself; each lives in its own repository. You can write your own against the same API.

| Integration | Good for | Repository |
|---|---|---|
| Raycast extension | Posting, searching and jumping between columns from a launcher | [notedeck-raycast](https://github.com/notedeck-dev/notedeck-raycast) |
| Stream Deck plugin | Posting, switching columns and a boss key from physical keys | [notedeck-streamdeck](https://github.com/notedeck-dev/notedeck-streamdeck) |
| Obsidian plugin | Clipping notes into a vault, posting from Obsidian, a timeline in the sidebar | [notedeck-obsidian](https://github.com/notedeck-dev/notedeck-obsidian) |

::: warning Not in the stores yet
None of the three is listed in the Raycast Store, the Stream Deck Marketplace or Obsidian's community plugins. Build and install them following the README of each repository. They have not been tested much on real machines either, so open an issue if something does not work.
:::

## What they have in common

All three use the same two entry points. Once you have set up one, the others work the same way.

**Operations that need a token** — anything that calls NoteDeck's API (posting, searching, listing accounts, fetching a timeline) needs a persistent API token.

1. Issue a token under Settings → Permissions (設定 → 権限) → "Persistent API tokens" and paste it into the integration's settings
2. Issue a separate token per integration and give it a name (`raycast`, `streamdeck`, `obsidian`, …). The name shows up in confirmation dialogs and in the record of what was done, so you can tell which integration did what
3. When issuing, pick what the token may do. The default is read-only; writes such as posting are allowed individually. The ceiling is the "External apps" permission on the same screen, and what actually applies is the intersection of both
4. Writes such as posting are always confirmed in the NoteDeck window before they run. The integration waits until you answer in NoteDeck

**Operations that need no token** — opening the post form, switching profiles, bringing a column to the front: these UI actions go through `notedeck://` links. No token, no permission, no confirmation, because you are the one opening the link. See [Opening from links](/en/docs/guide/links) for what links can do.

::: tip This is not a security boundary
Token permissions exist to prevent accidents in well-behaved integrations and to tell who did what. A program running as the same OS user can reach the same things NoteDeck itself can. See the same note under [Using AI](/en/docs/guide/ai#using-notedeck-from-an-external-ai-agent-mcp).
:::

Every integration only works while NoteDeck is running on the same machine. A development build of NoteDeck (`pnpm tauri:dev`) uses a different API port, so change the API URL in the integration's settings.

## Raycast

Calls NoteDeck as Raycast commands (macOS / Windows).

| Command | What it does | Needs |
|---|---|---|
| Post Note | Write a note (account, visibility, CW) and post it. ⌘O hands the text to NoteDeck's post form instead | token + `notes.write` |
| Open Post Form | Open NoteDeck's post form with the text filled in | nothing |
| Search My Notes | Search your own notes and memos in NoteDeck's local archive. Empty query shows recent ones. Enter opens the note in NoteDeck | token + `notes.readArchive` and `memos.read` |
| Jump to Column | Pick a deck column and bring it to the front | token (the read-only default is enough) |
| Switch Deck Profile | Switch the [profile](/en/docs/deck/profiles) by name | nothing |
| Ask AI | Open the AI column with the prompt filled in. Sending is up to you | nothing |
| New Memo | Create a local memo | token + `memos.write` |
| Hide NoteDeck / Show NoteDeck | Hide the window, or bring it back (boss key) | token (no permission needed) |
| Run Capability | Pick any NoteDeck capability (everything the command palette, plugins and AI can use) from a list, fill in parameters and run it. The result is shown as JSON | token + whatever that capability needs |

Run Capability is also a handy way to look up account ids and column ids for the other integrations.

## Stream Deck

Assigns NoteDeck actions to Stream Deck keys. Enter the API URL and token on the first key; every other NoteDeck key shares them.

| Action | What it does | Needs |
|---|---|---|
| Post Note | Post a preset text (with account, CW and visibility) | token + `notes.write` |
| Open Post Form | Open NoteDeck's post form with a preset text | nothing |
| Run Capability | Store a capability id and JSON parameters, run them with the key | token + whatever that capability needs |
| Focus Column | Bring a chosen column to the front | nothing |
| Switch Deck Profile | Switch to a chosen profile | nothing |
| Hide NoteDeck / Show NoteDeck | Hide the window, or bring it back (boss key) | token (no permission needed) |

The key shows ✓ on success and ⚠ on failure; the reason is in the plugin's log.

## Obsidian

Brings Misskey notes into your vault from Obsidian (desktop), posts from Obsidian, and shows a timeline in the sidebar.

| Command / view | What it does | Needs |
|---|---|---|
| Clip a note by URL | Paste a note URL and the note is written to the vault as Markdown with YAML frontmatter | token (the read-only default is enough) |
| Search NoteDeck's archive and clip | Search the notes NoteDeck has seen, across servers and accounts. Enter clips the note into the vault, Mod+Enter inserts a link at the cursor | token + `notes.readArchive` |
| Post a note | Post with the selection as the text (account, visibility and CW selectable) | token + `notes.write` |
| Open NoteDeck's post form with selection | Hand the selection to NoteDeck's post form | nothing |
| Timeline (sidebar) | Pick an account and show home / local / social / global. New notes arrive from NoteDeck's event stream. Click a note to clip it, open it in NoteDeck, open it on the server or copy the link | token (the read-only default is enough) |

Clipped notes go to the folder from the settings (default `NoteDeck/`) under the name "date handle id.md". Clipping the same note again opens the existing file instead of overwriting it. The frontmatter holds author, URL, date, visibility, CW and the quoted note; the body is kept as MFM, a CW becomes a collapsed callout, images are embedded, sensitive images and other files are linked.

::: tip Memos open directly, without the plugin
NoteDeck's [memos](/en/docs/deck/columns) are Markdown files in `memos/` inside the settings folder. Open that folder as an Obsidian vault and you can read and write them without any plugin. This plugin does not touch memos.
:::

Clip a note by URL only accepts note URLs on servers you are logged in to in NoteDeck (the note is fetched through that account). Notes from other servers are clipped from the search instead.

## Writing your own

All the three integrations do is send HTTP requests with a Bearer token to `127.0.0.1:19820` and open `notedeck://` links. Any language can do the same.

- The API reference is the "API docs" column (API ドキュメント) in [developer mode](/en/docs/#developer-mode). Capabilities are called with `POST /api/capabilities/<id>/execute`, and `GET /api/capabilities` lists every capability with its parameters and permissions
- To receive new notes and notifications as they arrive, subscribe to the Server-Sent Events at `GET /api/events`
- If the caller is an AI agent, connecting to [MCP](/en/docs/guide/ai#using-notedeck-from-an-external-ai-agent-mcp) with the same token is quicker

If you build an integration, open an issue and it will be listed on this page.
