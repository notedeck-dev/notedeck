---
sourceHash: 9afa90820193
---

# Using from the terminal and AI agents (notecli)

**notecli** is the part NoteDeck uses to talk to Misskey, taken out as a standalone command. Without any window, it fetches timelines, posts, reacts, searches and more from the terminal. It works even if NoteDeck itself is not installed.

Hand it to an AI agent that can run commands (Claude Code, Codex and the like) and the agent can read and write Misskey on its own. Results come back as JSON, so it also combines well with shell scripts and `jq`.

::: warning It runs without asking
notecli acts directly with the permissions of the account you logged in with. The safeguards in NoteDeck's AI chat and MCP — confirming on screen before a write, narrowing what each operation may do — do not apply. If you let an agent post, read [When you want safeguards](#when-you-want-safeguards) first.
:::

## Installation

::: code-group

```bash [GitHub Releases]
# Published on the same Release as NoteDeck, named notecli-<version>-<platform>
#   linux-amd64 / linux-arm64 / darwin-arm64 / windows-amd64.exe
gh release download --repo notedeck-dev/notedeck \
  --pattern 'notecli-*-linux-amd64' --output notecli
chmod +x notecli
sudo mv notecli /usr/local/bin/
```

```bash [AUR (Arch Linux)]
yay -S notecli-bin
```

```bash [Nix Flake]
nix profile install 'github:notedeck-dev/notedeck#notecli'
```

```bash [Cargo]
cargo install --git https://github.com/notedeck-dev/notedeck notecli
```

:::

Once installed, `notecli doctor` checks the database, where tokens are stored, and connectivity to your servers in one go.

## Logging in

A person logs in. You only do it once.

```bash
notecli login misskey.io
```

1. An authorization URL is printed; open it in a browser
2. Approve on the server's page
3. Come back to the terminal and press Enter

You can register as many accounts as you like. `notecli accounts` lists them and `notecli logout @user@host` removes one.

notecli keeps its accounts separately from the NoteDeck app. Even if you are logged in there, log in again in notecli.

## Trying it

```bash
notecli timeline                 # home timeline
notecli timeline local -l 50     # 50 notes from local
notecli post "Hello from notecli!"
notecli post "thinking out loud" --visibility home --cw "musing"
notecli react <note id> ":star:"
notecli search "Rust"
notecli notifications --keep-unread
```

With several accounts, choose one with `-a`. If you leave it out, the account you registered first is used.

```bash
notecli -a @taka@misskey.io timeline
```

### What it can do

| Kind | Commands |
|---|---|
| Read | `timeline` (home / local / social / global), `note`, `replies`, `thread`, `search`, `user`, `user-notes`, `emojis` |
| Addressed to you | `notifications`, `mentions`, `favorites` |
| Write | `post`, `update`, `delete`, `renote` |
| React | `react` / `unreact`, `favorite` / `unfavorite`, `follow` / `unfollow` |
| Manage | `login`, `logout`, `accounts`, `doctor` |

Detailed arguments are in `notecli --help` and each command's `--help` (for example `notecli post --help`). The help text is in Japanese.

### Output formats

These work with every command.

| Option | Shape | Good for |
|---|---|---|
| none | Multi-line display for people | Reading by eye |
| `--json` | JSON array / object | AI agents, scripts |
| `--jsonl` | One JSON object per line | Streaming through `jq` |
| `-c` / `--compact` | One tab-separated record per line | `fzf`, `grep`, `awk` |
| `--ids` | IDs only | Piping to `xargs` |

```bash
# IDs of notes containing "Rust" among the latest 100
notecli timeline -c -l 100 | grep "Rust" | cut -f1

# React to a note picked with fzf
notecli timeline -c | fzf --with-nth=2.. | cut -f1 | xargs -I{} notecli react {} :star:

# IDs of notes by one user
notecli timeline --jsonl | jq -r 'select(.user.username == "taka") | .id'
```

On failure the exit code is non-zero. With `--json` / `--jsonl`, the error is also printed to standard error as `{"error": "...", "message": "..."}`. `doctor` is the exception: it prints its report to standard output and returns exit code 1 if any check failed (nothing goes to standard error).

## Letting an AI agent use it

The agent needs no special setup. If notecli is on PATH and you have logged in, the agent simply calls it from the shell.

Examples of what to ask:

- "Read 50 notes from my home timeline with `notecli` and summarize the topics in three lines"
- "Look at `notecli mentions` and list the ones that seem to need a reply. Only draft the replies; do not post"
- "Summarize these release notes and post them with `notecli post`, visibility home"

To avoid explaining it every time, write it into the agent's instruction file (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex).

```markdown
## Misskey

- Use `notecli` to read and write Misskey. Usage is in `notecli --help`
- Add `--json` when reading results
- Name the account explicitly with `-a @user@host`
- Add `--keep-unread` when reading notifications (otherwise they are all marked read)
- Before posting, renoting, deleting or following, show the text and the target and ask for confirmation
```

Worth knowing:

- **Reading notifications marks them read.** Like the official web client, `notecli notifications` marks everything read the moment it fetches. If the agent is only taking a look, add `--keep-unread`
- **Posts are public by default.** If you want to be more reserved, put `--visibility home` or `--local-only` in your instructions
- **Do not leave login to the agent.** Authorization is something a person does in the browser

## When you want safeguards

notecli is a tool that uses your Misskey token directly; NoteDeck's confirmations and permissions are not in between. If a note the agent reads says "post this" and the agent simply obeys, the only things that stop it are the agent's own confirmation settings and your instructions.

Any of these helps:

- **Narrow what the agent may run.** Allow only reading commands (`notecli timeline` and so on) automatically, and require confirmation every time for writes such as `notecli post`. In Claude Code you can decide this per command in the permission settings
- **Register only a dedicated account.** Create a separate account for the agent, and log only that account in to notecli in the environment where the agent runs. `-a` merely selects an account; it does not make the others unusable. If your personal account is registered in the same environment, the agent can read its notifications and post from it just by changing `-a`
- **Use NoteDeck's MCP.** Every write shows a confirmation on NoteDeck's screen, and each token can be limited to certain operations. It works only while NoteDeck is running → [Using AI → Using NoteDeck from an external AI agent](/en/docs/guide/ai#using-notedeck-from-an-external-ai-agent-mcp)

| | notecli | NoteDeck's MCP |
|---|---|---|
| NoteDeck app | Not needed | Must be running |
| Confirmation before writes | Depends on the agent's settings | Always shown on NoteDeck's screen |
| Per-operation permissions | None (everything the logged-in account can do) | Chosen per token |
| Good for | Servers and CI, scripts, mostly-reading work | Your everyday machine, when the agent also posts |

## Where data lives

- Account list and note cache: `notecli/notecli.db` in the OS data folder (`~/.local/share/notecli/` on Linux)
- Tokens: the binaries from Releases and AUR store them in the database above. A binary you build yourself with Cargo stores them in the OS keychain, and on Linux without Secret Service (servers, WSL2, containers) in an encrypted file

The folder contains tokens, so do not hand it to others or put it in a public repository.

## Troubleshooting

- **`no accounts found`**: you have not logged in yet. Run `notecli login <host>`
- **Authentication errors**: check token validity and server connectivity with `notecli doctor`. If you revoked the app's permission on the server, `logout` and then `login` again
- **Accounts from the NoteDeck app do not appear**: they are stored elsewhere. Log in again in notecli
