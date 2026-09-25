---
sourceHash: 351a0242008d
---

# Plugins

Plugins are extensions written in AiScript. They can add actions on notes and users, rewrite what you post, or add commands to the command palette. The idea is the same as Misskey's own plugins, with NoteDeck-specific APIs on top.

## Minimal example

Start with a meta header. If you omit the AiScript version, the file is parsed by the old parser and the interruptors described below cannot be used.

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
| `register_command` | It is invoked as a command |

::: warning Interruptors run synchronously
`*_interruptor` hooks are called synchronously, so they cannot show a confirmation dialog. When guarding posts, handle things automatically without asking (add a CW automatically, lower the visibility).
:::

## NoteDeck-specific APIs

| API | What it does |
|---|---|
| `Nd:version` | The app version |
| `Nd:call(id, params)` | Call a capability. Succeeds only within your permissions. If the confirmation dialog is cancelled, it does not throw; it returns a value whose `Core:type` is `"error"` |
| `Nd:capabilities()` | The list of callable capabilities |
| `Nd:http(url, options)` | An HTTP request to the outside |
| `Nd:on(event, handler)` | Subscribe to events inside the app |
| `Nd:register_command(...)` | Add a command to the command palette |

Events you can subscribe to with `Nd:on` include notes arriving, notifications arriving, switching accounts, columns being added or removed, streaming connection state, memos being created, updated or deleted, skills being edited, and themes being applied.

## Misskey-compatible APIs

`Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize` are available. If you bring over a plugin from Misskey itself, check that it stays within this set.

## Permissions

Operations with side effects, such as external requests or posting notes, need permissions. Declare them in `permissions` in the meta header, and the user approves them on install. Undeclared operations are rejected at run time.

## Make and share

The quickest way is to ask an AI column "make a plugin that does X". To write one by hand, put it in the settings folder. You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)).
