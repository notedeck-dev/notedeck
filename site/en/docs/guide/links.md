---
sourceHash: 875f862cac13
---

# Opening from links (notedeck://)

The desktop version of NoteDeck registers the `notedeck://` URL with the OS when it is installed. Open one of these URLs from a browser, a launcher, a notes app or a script, and the running NoteDeck comes to the front and opens that screen.

Use it for launcher shortcuts, bookmarks for the columns you open every morning, or calling up the post form from external tools.

## Nothing is sent for you

Anyone can make a `notedeck://` URL, and a web page can embed one for you to click. So a link never posts a note or sends anything to the AI.

- The post form and the AI column open with the text filled in; you press send yourself
- Installing from the store only installs items listed on MisStore
- A link that points to a profile, column or store item that cannot be found does nothing

## App-wide actions

These actions do not pick an account. URL-encode the values (a space is `%20`, a line break is `%0A`).

| URL | What happens |
|---|---|
| `notedeck://compose?text=<text>&cw=<cw>&visibility=<visibility>` | Opens the post form with the text, content warning and visibility filled in. All are optional. Visibility is one of `public` `home` `followers` `specified` |
| `notedeck://ai?prompt=<text>` | Opens the AI column and puts the text in the input. Adds an AI column if there is none |
| `notedeck://memo/new?text=<text>` | Creates one memo with the text |
| `notedeck://profile/<name>` | Switches the deck [profile](/en/docs/deck/profiles). If no name matches, looks it up as an id |
| `notedeck://column/<id>` | Makes that column active |
| `notedeck://install-plugin?id=<id>` | Installs a plugin from [MisStore](/en/docs/guide/store) |
| `notedeck://install-theme?id=<id>` | Installs a theme from MisStore |

A column's id is written in the profile file under `profiles/` in the settings folder.

## Opening an account's screens

The form `notedeck://<server>/...` opens a screen on that server. `<server>` is a host name like `misskey.io`, and you need to be logged in with an account on that server.

### Adding columns

| URL | Column added |
|---|---|
| `notedeck://<server>/timeline/<kind>` | Timeline. Kind is `home` `local` `social` `global` (`home` when omitted) |
| `notedeck://<server>/notifications` | Notifications |
| `notedeck://<server>/search?q=<query>` | Server search |
| `notedeck://<server>/antenna/<id>` | Antenna |
| `notedeck://<server>/channel/<id>` | Channel |
| `notedeck://<server>/favorites` | Favorites |
| `notedeck://<server>/mentions` | Mentions |
| `notedeck://<server>/direct` | Direct |
| `notedeck://<server>/chat` | Chat |
| `notedeck://<server>/announcements` | Announcements |
| `notedeck://<server>/drive` | Drive |
| `notedeck://<server>/gallery` | Gallery |

### Opening windows

| URL | Window opened |
|---|---|
| `notedeck://<server>/note/<id>` | Note |
| `notedeck://<server>/user/<id>` | User |
| `notedeck://<server>/user/<id>/following` | Following list |
| `notedeck://<server>/user/<id>/followers` | Followers list |
| `notedeck://<server>/list/<id>` | List |
| `notedeck://<server>/clip/<id>` | Clip |
| `notedeck://<server>/gallery/<id>` | Gallery post |
| `notedeck://<server>/page/<id>` | Page |
| `notedeck://<server>/play/<id>` | Play |
| `notedeck://<server>/instance/<host>` | Information on a federated server |

The id is the server's internal id (for a user, not `@name` but the `id` you can see in Raw JSON and similar places).

## Finding a URL

In the desktop version, the title bar shows the URL of the active column or window. For screens you open often, copy the URL from there and register it as a bookmark or in a launcher.

Opening a column's URL adds another column of the same kind. To just move to a column already on the deck, use `notedeck://column/<id>`.
