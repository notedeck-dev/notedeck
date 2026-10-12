---
sourceHash: e53405b52499
---

# Skills

A skill is a Markdown instruction sheet that shapes how the AI behaves. Write down its role and tone, which data to look at and how, and what format to answer in, and the AI follows it every time.

Skills are something the AI **reads**, separate from the features the AI can **execute**. Executable features (operations like applying a theme or adding a column) are called capabilities, and only those you allow in the [permission settings](/en/docs/guide/ai#permissions) can be used. No matter what a skill says, operations you have not allowed are not executed.

Separately from skills, the AI has a [personality and memory](/en/docs/guide/ai#personality-and-memory) (a core that stays the same when you switch skills). What a skill dresses up is the tone and role (the character) on top of it.

## Minimal example

Put frontmatter at the top of a Markdown file and the body below it.

```markdown
---
id: my-skill
name: Summarizer
mode: manual
---

You are an assistant AI for NoteDeck, a Misskey client.
Answer concisely in English.
```

If you omit `id`, the file name is used. You can also write `description` / `author` / `version` / `iconUrl`.

## When it is read (`mode`)

| mode | When it is given to the AI | Good for |
|---|---|---|
| `always` | Always, in every conversation | Guidelines for behavior across the app |
| `manual` | While it is turned on in the Skills column | Switching personas, expert knowledge brought in only when needed |
| `trigger` | When the input contains a word from `triggers`. Once it matches, it stays on for the rest of that session | Knowledge needed only for specific topics |
| `heartbeat` | Every periodic run | Checking in periodically and reporting |

For `mode: trigger`, list the words in `triggers`. Matching is a case-insensitive substring match. Having every skill read in every conversation adds cost, so the more specialized the content, the better `trigger` fits. The on state of a `manual` skill is saved as `active: true` in the frontmatter.

## Reserved skills

`skills/` holds two files whose name and role are fixed. They cannot be renamed, deleted, switched to another mode or disabled, and they do not appear in the Skills column. You edit them from the Agent settings. While they are effectively empty, they are not given to the AI.

- `AGENTS.md` — the rules. Always given (fixed to `always`). "Rules" in the Agent settings
- `HEARTBEAT.md` — the steps of the rounds. Given on every periodic run (fixed to `heartbeat`). "Edit the steps" under HEARTBEAT in the Agent settings

## Writing principles

**Fix the role and tone at the start** — first write what the AI does and how it answers.

**Write the order in which to look at data** — notes and account information visible on screen are given to the AI every time. Making it fetch them again through capabilities when that is enough adds needless round trips. Write something like "when referring to notes on screen, look at what you were given first; fetch the list only when you need every account".

**Specify the response format strictly** — vague instructions tend to produce long answers. Constraints such as "the first line is the conclusion in under 30 characters" or "at most 5 bullet points" work well.

**Write what to do on failure** — decide what to answer when data cannot be fetched, when permissions are missing, or when the request cannot be understood.

**Name capabilities explicitly** — if you only write "change the theme", the AI may answer "done" without actually doing anything. Write the steps and names, like "get the list with `themes.list` → pick the id whose name matches → apply it with `themes.apply`".

## Skills that run periodically

Skills with `mode: heartbeat` run periodically while HEARTBEAT is turned on in the Agent settings (off by default). Basically they run while the app is open; make it [resident](/en/docs/notemaid#making-it-resident) and they keep going after you quit the app. They also run once when the machine wakes from sleep.

List "what to watch" (cheap, read-only capabilities such as the notification list) in `cheapCheckCapabilities` in the frontmatter, and the AI call itself is skipped while nothing has changed since last time. Without that declaration, the AI is called — and billed — every time, even when nothing changed. Even when skips keep happening, it always runs at a fixed interval.

If you watch something that changes on every run (such as the current time), it is always judged as changed and nothing is skipped. Choose based on what should wake it up.

Permissions during HEARTBEAT are a separate row from chat (read-only by default), and you can also cap how many times a day the AI is started. HEARTBEAT does not run on a connection where a local CLI is the AI.

## Handling secrets

Items that amount to tokens or passwords are removed automatically from the data given to the AI.

## Make and share

Ask an AI column "make a skill that does X". To write one by hand, just put a single Markdown file in `skills/` in the settings folder. The entrance for creating and editing is opened by [developer mode](/en/docs/#developer-mode). You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#スキル)).

For the list of capabilities and details on permissions, see [SKILLS.md](https://github.com/notedeck-dev/notedeck/blob/main/SKILLS.md) in the repository.
