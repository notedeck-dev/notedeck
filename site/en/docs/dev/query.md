---
sourceHash: 0be06c29295f
---

# Column queries

A column query is an expression that filters the notes flowing into a column. It is written in a subset of AiScript, and **notes for which it returns true are shown**. To write "hide X", write the condition and then wrap the whole thing in `!(...)`.

```is
/// @ 1.2.1
// Hide notes containing a specific keyword — true = show
!(note.text != null && note.text.lower().incl("spoiler"))
```

Edit and save it from the filter in the column settings. Multiple queries are combined with And, so it is easiest to give each query a single job.

## What you can reference

The only thing you can freely reference in an expression is `note`. The following fields evaluate fast and can also be used to search notes stored locally.

```
note.text  note.cw  note.visibility  note.localOnly
note.renoteId  note.replyId
note.user.username  note.user.host  note.user.name
note.files.len  note.reactions["emoji_name"]
```

You can use comparisons and logical operators, the string methods `incl` / `starts_with` / `ends_with` / `lower` / `upper`, the array methods `incl` / `len`, `let`, and pure non-recursive functions.

Fields outside this set (`note.user.isCat`, `note.channelId`, `note.renote.text`, `note.poll` and so on) also work, but fall back to a slow path that evaluates notes one at a time. The result is the same; only the speed differs.

## Things to watch when writing

- **Avoid null with `&&` short-circuiting** — `note.text` / `note.cw` / `note.user.name` can be null. Write `note.text != null && note.text.incl("x")`. `let` is evaluated first, so it does not work as a guard
- **Do not break a line after a binary operator** — keep the expression on one line or move it into a function
- **No external communication** — `Mk:api`, getting the current time, and asynchronous work are rejected on save
- **There is no dedicated hashtag field** — match against the text instead. Prefix matching can hit tags you did not intend
- **Do not rebuild what the column settings already have** — excluding renotes, excluding replies, media only and excluding bots are available as toggles

## Install and share

You can use a query installed from the [store](/en/docs/guide/store) as is, or edit it for your own use. You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#クエリ)).
