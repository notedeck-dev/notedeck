---
sourceHash: 234654635604
---

# Finding notes

Search in NoteDeck has two layers.

| | Where it looks | What it finds |
|---|---|---|
| **Server search** (サーバー検索) | The Misskey server | Notes the server makes searchable |
| **Client search** (クライアント検索) | Your local database | Notes that flowed across your screen (across all servers and accounts) |

Most cases of "I know I saw it but cannot find it" are notes the server does not index. NoteDeck also keeps the notes it has shown locally, so you can find them there. Both open as columns, and you can use them side by side.

## Client search column

The "Client search" column searches the notes stored locally across servers and accounts at once. You can find a note even if you do not remember which server you saw it on.

- Besides search terms, filter by scope (all / a specific server / a specific account), author (`name` or `name@host`), date range, and whether it has attachments
- You can search with filters alone and no search terms, for example "with images, in the last week"
- Search terms and filters are saved in the column, so you can leave it open with the conditions in place
- The same note seen on several servers is merged into one row, and the row's breakdown shows where you saw it
- What is stored locally can be searched even without logging in to the server

::: warning Chat is not included
Chat messages cannot be searched by either server search or client search.
:::

## How notes stay with you

Notes that flow through your timelines are stored in a local SQLite database automatically. You do not need to do anything. How much to keep is chosen under cache in the settings. Keep in mind that every note that passed before your eyes, including followers-only and direct ones, is stored unencrypted.

As a result:

- If a note is deleted on the server, your local copy remains
- If federation breaks and the other server becomes unreachable, you can still read notes already fetched
- You can read past timelines again while offline

::: warning Only what flowed past is stored
Notes you have never displayed are not stored locally. You cannot go back through the past posts of users you do not follow.
:::

## Narrowing each column's view

Separately from search, there is a mechanism called **column queries**. It filters the notes flowing into a column through conditions you write yourself.

- Only show notes that contain certain keywords
- Hide notes from certain users or servers
- Only show notes with attachments

Conditions are written as AiScript expressions. You can save what you write under a name and reuse it in several columns. You can also install queries others wrote from the [store](/en/docs/guide/store).

Queries are managed from the "Queries" (クエリ) column, and applied by switching them in a timeline column's filter menu.
