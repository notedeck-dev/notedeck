---
sourceHash: 5f622afd95af
---

# Plugins

Plugins are extensions written in AiScript. They can add actions on notes and users, rewrite what you post, or add commands to the command palette. The idea is the same as Misskey's own plugins, with NoteDeck-specific APIs on top.

## Minimal example

Start with the AiScript version and a meta header. The version line is required: without it the plugin does not start, and the log says `version header required`. Execution always uses the newer interpreter.

```is
/// @ 1.2.1
### {
  name: "Sample"
  version: "1.0.0"
  author: "you"
  description: "What this plugin does"
  permissions: []
}
```

Only `name` and `version` are required in the meta. If you write `config`, its values can be read with `Plugin:config`.

## Hooks you can register

Register hooks with `Plugin:register_*`. A plugin runs once when it is loaded, and the functions it registers there are called later for each event.

| Hook | Called when |
|---|---|
| `register_note_action` | It is chosen from a note's menu |
| `register_user_action` | It is chosen from a user's menu |
| `register_post_form_action` | Its button in the post form is pressed |
| `register_note_view_interruptor` | Right before a note is displayed |
| `register_note_post_interruptor` | Right before a note is posted |
| `register_page_view_interruptor` | Right before a page is displayed |

Command palette commands are added not with a hook but with `Nd:register_command`, described below.

::: warning Interruptors run synchronously
`*_interruptor` hooks are called synchronously, so they cannot show a confirmation dialog. When guarding posts, handle things automatically without asking (add a CW automatically, lower the visibility).
:::

## NoteDeck-specific APIs

| API | What it does |
|---|---|
| `Nd:version` | The app version |
| `Nd:call(id, params)` | Call a capability. Succeeds only within your permissions. If the confirmation dialog is cancelled, it does not throw; it returns a value whose `Core:type` is `"error"` |
| `Nd:capabilities()` | The list of callable capabilities |
| `Nd:http(url, options)` | An HTTP request to the outside. Returns `{ status, headers, body }`. A transport failure (DNS failure, connection refused, timeout) does not throw either: `status` is `0` and `error` holds the reason |
| `Nd:on(event, handler)` | Subscribe to events inside the app |
| `Nd:register_command(...)` | Add a command to the command palette |
| `Plugin:open_url(url)` | Open a URL in the default browser |

Events you can subscribe to with `Nd:on` are notes arriving, notifications arriving, columns being added or removed, streaming connection state, memos being created, updated or deleted, skills being edited, and themes being applied.

Handlers run once per app process: even with several windows open, an event reaches only one representative window. Note display hooks run in every window, so keep side effects out of them.

A command added with `Nd:register_command` can be called from the command palette, keybindings, the AI's tools and the local API. When called from the AI or the local API, the effective permissions are "the caller's permissions ∩ the plugin's permissions".

## When a call fails

AiScript has no try / catch. When an API call fails, that piece of work (the handler) stops there. The plugin itself keeps running, and the next action or event still works.

The user sees the stop in one of these ways.

- Work started by a user action (a note menu, a button): the first line of the error appears in a toast
- Widgets: the error appears in the widget frame. It goes away the next time the widget redraws
- Work started by an event or a timer: it is only recorded in the run log

| API | When it fails |
|---|---|
| `Nd:http` | Does not stop. The outcome of the request (4xx / 5xx, connection failure) comes back as a value |
| `Mk:api` | Stops |
| `Nd:call` | Stops. Only a cancelled confirmation dialog does not stop; it returns an error value |

When permission is missing or the arguments are wrong, every API stops.

`Nd:call` may return more kinds of error values in the future. Check the name to tell whether it was a cancellation.

```
let res = Nd:call("notes.create", { text: "hello" })
if Core:type(res) == "error" && res.name == "user_cancelled" {
  // cancelled
}
```

In Misskey itself, `Mk:api` does not stop on failure; it returns an error value (`request_failed`). If your plugin runs on both, keep the `Core:type(res) == "error"` branch. NoteDeck's `Mk:api` is planned to return failures the same way.

## Misskey-compatible APIs

`Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize` are available. If you bring over a plugin from Misskey itself, check that it stays within this set. Values saved with `Mk:save` go into the app's internal storage rather than a file, and are not included in [backups](/en/docs/config/backup).

## Permissions

What plugins can do is decided by the "Plugins" row of the [permission settings](/en/docs/guide/ai#permissions). The default is a safe, mostly read-only range plus requests to the outside; writes such as posting are allowed individually. `Nd:call` / `Nd:http` / `Mk:api` are all judged by this setting, and rejected operations show up as a rejection badge in the Plugins column. Operations that amount to writing skills or instructing the AI are always rejected regardless of the setting.

`permissions` in the meta header is a declaration used when updating from the store: it shows "newly requested permissions" and asks for your consent again.

### Connecting to a port on this device

`Nd:http` refuses connections to this device (`localhost` / `127.0.0.1` / `[::1]`) by default. To call a process running on your machine, such as your own translation server or a query endpoint of a local database, declare the port in the `loopback` key of the meta header.

```is
### {
  name: "Local translate"
  version: "1.0.0"
  loopback: [8080]
}
```

On the first request to a declared port, NoteDeck asks the user whether to allow this plugin to connect to that port (only inside an action a person triggered from a note or user menu, the post form, or the command palette; startup code, `Nd:on` events and timers are refused without asking, and the port can be allowed from the plugin's settings). The consent is tied to the plugin body, so after an update or an edit the next request asks again. Per-request confirmation stays as it is.

While the plugin runs on behalf of the AI, another plugin, or an external app, it cannot reach a local port even with consent. Widgets, Play and Pages have no place for the declaration and are excluded. NoteDeck's own ports are never reachable, declared or not. The response is a single round trip of text and is treated as untrusted, like anyone else's post.

## Where they are stored

Plugins are stored in `plugins/` in the settings folder as two files: the code `<slug>.is` and the metadata `<slug>.meta.json5`. The list is built from the meta files, so a `.is` on its own is not picked up. When placing one by hand, the reliable way is to create a new one in the developer-mode editor and then replace its contents. The file name is a slug made from the display name (or the storeId for store items), and references use the id inside the file. If the same id appears twice, the later one is skipped and a toast tells you.

## Make and share

The quickest way is to ask an AI column "make a plugin that does X" (install the author skill from MisStore first). The entrance for creating and editing is opened by [developer mode](/en/docs/#developer-mode). You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)).
