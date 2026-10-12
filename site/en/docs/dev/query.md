---
sourceHash: 2d775546f9f4
---

# Column queries

A column query is an expression that narrows down the notes flowing into a column. It is written in a subset of AiScript, and **notes for which it returns true are shown**. To write "hide X", write the condition and then wrap the whole thing in `!(...)`.

```is
/// @ 1.2.1
// Hide notes containing a specific keyword — true = show
!(note.text != null && note.text.lower().incl("spoiler"))
```

Queries are defined, edited and installed from the store in the "Queries" column, and which columns they apply to is switched with the toggles in each column's filter menu. Besides timelines, they can also be applied to the results of [client search](/en/docs/guide/search#client-search-column). Multiple queries are combined with And, so it is easiest to give each query a single job.

## What you can reference

The only thing you can freely reference in an expression is `note`. The following fields evaluate fast and can also be used to search notes stored locally.

```
note.text  note.cw  note.visibility  note.localOnly
note.renoteId  note.replyId
note.user.username  note.user.host  note.user.name
note.files.len  note.reactions["emoji_name"]
```

You can use comparisons and logical operators, the string methods `incl` / `starts_with` / `ends_with` / `lower` / `upper`, the array methods `incl` / `len`, `let`, and pure non-recursive functions.

Fields outside this set (`note.user.isCat`, `note.channelId`, `note.renote.text`, `note.poll` and so on) also work, but fall back to a slow path that evaluates notes one at a time. The result is the same; only the speed differs. The ⚡ / 🐢 badge in the Queries column tells you which path a query runs on (⚠ means part of it cannot be interpreted).

## Things to watch when writing

- **Avoid null with `&&` short-circuiting** — `note.text` / `note.cw` / `note.user.name` can be null. Write `note.text != null && note.text.incl("x")`. `let` is evaluated first, so it does not work as a guard
- **Do not break a line after a binary operator** — keep the expression on one line or move it into a function
- **No external communication** — `Mk:api`, getting the current time, and asynchronous work are rejected on save
- **There is no dedicated hashtag field** — match against the text instead. Prefix matching can hit tags you did not intend
- **Do not rebuild what the column settings already have** — excluding renotes, excluding replies, media only and so on are available as toggles in the column's filter menu (which toggles appear depends on the timeline kind and the server)

## When it stops working

- If you disable the query itself, the columns applying it treat it as if it did not exist
- A query that takes too long to evaluate is stopped automatically. You can "Resume" it in the Queries column
- If a reference has gone missing or something cannot be interpreted, the note in question is left hidden. In safe mode queries themselves are stopped and everything is shown
- Edits keep a history, so you can go back to a previous version

## Where they are stored

Queries are stored in `queries/` in the settings folder as two files: the expression `<slug>.is` and the metadata `<slug>.meta.json5`. Like the other distributed items, they are managed in pools for all accounts and per account.

## Install and share

You can use a query installed from the [store](/en/docs/guide/store) as is, or edit it for your own use. Installing alone does not apply it to any column, so turn it on in the filter menu of the column that should use it. When the store has an update, you are told with a diff. The entrance for creating and editing is opened by [developer mode](/en/docs/#developer-mode). You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#クエリ)).
