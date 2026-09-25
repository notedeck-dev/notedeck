---
sourceHash: d9c8291a91e5
---

# Skills

A skill is a Markdown instruction sheet that shapes how the AI behaves. Write down its role and tone, which data to look at and how, and what format to answer in, and the AI follows it every time.

Skills are something the AI **reads**, separate from the features the AI can **execute**. Executable features (operations like applying a theme or adding a column) are called capabilities, and only those you allow in the [permission settings](/en/docs/guide/ai) can be used. No matter what a skill says, operations you have not allowed are not executed.

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

## When it is read (`mode`)

| mode | When it is given to the AI | Good for |
|---|---|---|
| `always` | Always, in every conversation | Guidelines for behavior across the app |
| `manual` | Only when switched on in the UI | Switching personas, expert knowledge brought in only when needed |
| `trigger` | Only on turns whose input contains a word from `triggers` | Knowledge needed only for specific topics |
| `heartbeat` | Every periodic run | Checking in periodically and reporting |

For `mode: trigger`, list the words in `triggers`. Having every skill read in every conversation adds cost, so the more specialized the content, the better `trigger` fits.

## Writing principles

**Fix the role and tone at the start** — first write what the AI does and how it answers.

**Write the order in which to look at data** — notes and account information visible on screen are given to the AI every time. Making it fetch them again through capabilities when that is enough adds needless round trips. Write something like "when referring to notes on screen, look at what you were given first; fetch the list only when you need every account".

**Specify the response format strictly** — vague instructions tend to produce long answers. Constraints such as "the first line is the conclusion in under 30 characters" or "at most 5 bullet points" work well.

**Write what to do on failure** — decide what to answer when data cannot be fetched, when permissions are missing, or when the request cannot be understood.

**Name capabilities explicitly** — if you only write "change the theme", the AI may answer "done" without actually doing anything. Write the steps and names, like "get the list of themes → pick the id whose name matches → apply it".

## Skills that run periodically

Skills with `mode: heartbeat` run periodically for as long as the app is running. If you declare in the frontmatter what to watch, the AI call itself is skipped while nothing has changed since last time. Without that declaration, the AI is called — and billed — every time, even when nothing changed.

If you watch something that changes on every run (such as the current time), it is always judged as changed and nothing is skipped. Choose based on what should wake it up.

## Handling secrets

Items that amount to tokens or passwords are removed automatically from the data given to the AI.

## Make and share

Ask an AI column "make a skill that does X". To write one by hand, just put a single Markdown file in the settings folder. You can distribute what you make on [MisStore](https://store.notedeck.io) ([how to submit](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [format](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#スキル)).

For the list of capabilities and details on permissions, see [SKILLS.md](https://github.com/notedeck-dev/notedeck/blob/main/SKILLS.md) in the repository.
