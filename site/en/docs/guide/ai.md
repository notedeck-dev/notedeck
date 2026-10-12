---
sourceHash: eb9f64031606
---

# Using AI

NoteDeck can have AI built in, but **using it is optional**. It only turns on when you connect an AI provider's API key or make a local CLI the AI, and everything else works without it.

The app has no scheme for paying AI usage fees on your behalf. You are billed directly by the provider you signed up with.

The AI itself (the agent loop and HEARTBEAT) runs in a process separate from the app. You normally never notice it; for how it works, see [The AI process](/en/docs/notemaid).

## Connecting

1. Under **Connections** (接続) in the settings menu, register your provider's API key
2. Under **Agent** (エージェント) in the settings menu, choose the connection you registered

Templates are built in for Anthropic, OpenAI, xAI, Google, OpenRouter and OpenCode Go, so you just pick one and paste your API key.

Two formats are supported: **Anthropic Messages compatible** and **OpenAI Chat Completions compatible**. Even a service without a template — your own LLM gateway, for example — can be registered by hand as long as it speaks one of them.

API keys are stored in the OS keychain. They are never written into settings files, and neither plugins nor the AI itself can read them.

### Making a local CLI the AI

Instead of an API key, you can use an AI CLI that is already installed and logged in on your machine (Claude Agent (Claude Code) / Codex / OpenCode / Hermes Agent / Grok Build) as the AI as it is. Choose "Local CLI" (手元の CLI) under Connections and the CLIs that were found are listed.

- Permission requests from the CLI appear as the chat's confirmation dialog. Permissions are decided by the "AI chat" row
- "What it remembers about you" is passed to the CLI as well by default. If you do not want that, turn off "Also pass it to the local CLI" under "Memory" (it is sent to the CLI's provider and may end up in the CLI's own memory)
- HEARTBEAT does not run through this route

## What it can do

Besides chatting in an AI column, you can send notes to the AI straight from the note menu (summarize, translate and so on).

The AI can also operate the app. Adding columns, switching accounts, making themes, changing keybindings — just ask in the conversation. Places the AI touched light up on screen, so you can see what happened.

**A confirmation dialog always appears before actions that reach outside**, such as posting or reacting. Nothing gets posted without you.

## Deciding what it sees

You choose in the settings what information is passed to the AI.

- The account you are currently using
- Open columns
- Notes visible on screen
- Conversation history

Turn off whatever it does not need.

Memos are not passed all the time. The memory the AI carries over lives under "Memory" (below), and it searches for individual memos only when it needs them.

## Personality and memory

The AI has a **personality** that stays the same when you switch characters, and two kinds of memory. You can read them any time under "Persona" (ペルソナ) and "Memory" (メモリー) in the Agent settings.

- **Personality** (Persona): the core of its values, boundaries and tone. The AI never rewrites it on its own; it proposes a change and waits for your approval. Editing the text directly is done in a developer-mode tab or an external editor
- **What it remembers about you** (Memory): how to address you, how you like it to talk, and other things you told it in conversation. You can fix or delete it line by line. Turn off "Remember things about me" and it is neither passed on nor added to ("Forget everything" is a separate action)
- **Notes to self** (Memory): small facts and decisions the AI picked up itself. You can fix or delete them line by line

Guidelines for how the AI behaves go under "Rules" on the same screen. Tone and role can be dressed up with a [skill](/en/docs/dev/skill)'s "Character", and the personality stays when you switch skills.

The first time you open an AI column you can start with "Tell me what to call you". The AI decides its own name and vibe with you and asks only how to address you. It will not ask unless you do.

Right after the AI has read someone else's posts, writing memory always asks for confirmation. The confirmation says which posts were read and whether the text it wants to write appears verbatim in someone else's post. Proposals to the personality need approval every time and cannot be skipped. While it is house-sitting (HEARTBEAT) it never writes memory.

## Permissions

What the AI can do is controlled by permission settings. The defaults are conservative and mostly read-only.

Permissions are independent per purpose. The AI in chat and the AI running in HEARTBEAT (described below) are configured separately; loosening one does not affect the other. The rows for plugins and external apps are on the same screen.

## Running while you are away (HEARTBEAT)

A way to run the AI periodically. You can have it keep watch, for example "tell me if anything important comes in among new notifications". Turn it on under HEARTBEAT in the Agent settings, and write what it should do with "Edit the steps" (巡回の手順を編集).

- If there is nothing to report, it stays quiet
- Results pile up in the session you choose. Reports the AI marked "notify me", actions waiting for confirmation and automatic stops also land in **app notifications** (the inbox); press one and the relevant screen opens
- Turn on "Quick check first" (まず軽く確認) and the AI is not called while nothing has changed since last time
- You can cap how many times a day the AI is started; when the cap is reached it stops automatically
- After repeated failures it stops automatically and warns you (so it does not keep failing unnoticed)

By default it runs only while the app is open. Turn on "Keep running after the app exits" and [the AI process stays resident](/en/docs/notemaid#making-it-resident); reports from while the app was closed arrive as one summary the next time you open it.

Because it runs unattended, its permissions are separate from chat and stricter by default. While unattended it never writes memory, and actions that need confirmation are not run but left in the target session as "confirm later, then run" cards.

::: warning Watch the cost of leaving it running
HEARTBEAT calls the API periodically. Decide on the interval and permissions before turning it on. You can also set a daily token budget per connection.
:::

## Using NoteDeck from an external AI agent (MCP)

It also works the other way round: external AI agents such as Claude Code or Claude Desktop can use NoteDeck as a tool. NoteDeck has a built-in MCP (Model Context Protocol) server that exposes the same capabilities the AI chat uses, such as searching and posting notes.

1. Issue a token under Settings → Permissions → "Persistent API tokens". Right after issuing, the screen shows a registration command for Claude Code and a config JSON for Claude Desktop; copy the one you need
2. What external apps may do is governed by the "External apps" permissions on the same screen. The default is read-only; writes such as posting are allowed individually
3. Writes are always confirmed in the NoteDeck window before they run. An external AI never posts on its own

Apps that connect over HTTP, like Claude Code, talk to `http://127.0.0.1:19820/mcp` directly. Apps that launch servers over stdio, like Claude Desktop or Cline, are given the bundled `notemaid` as `notemaid mcp`, which forwards to the running NoteDeck. Both only work while NoteDeck is running.
