---
sourceHash: 04f3f7a371d2
---

# Using AI

NoteDeck can have AI built in, but **using it is optional**. It only turns on when you connect your own API key, and everything else works without it.

The app has no scheme for paying AI usage fees on your behalf. You are billed directly by the provider you signed up with.

## Connecting

1. In the connections window, register your provider's API key
2. In the AI settings, choose the connection you registered

Templates are built in for Anthropic, OpenAI, xAI, Google, OpenRouter and OpenCode Go, so you just pick one and paste your API key.

Two formats are supported: **Anthropic Messages compatible** and **OpenAI Chat Completions compatible**. Even a service without a template — your own LLM gateway, for example — can be registered by hand as long as it speaks one of them.

API keys are stored in the OS keychain. They are never written into settings files, and neither plugins nor the AI itself can read them.

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
- Memos

Turn off whatever it does not need.

## Permissions

What the AI can do is controlled by permission settings. The defaults are conservative and mostly read-only.

Permissions are independent per purpose. The AI in chat and the AI running in HEARTBEAT (described below) are configured separately; loosening one does not affect the other.

## Running while you are away (HEARTBEAT)

A way to run the AI periodically while the app is open. You can have it keep watch, for example "tell me if anything important comes in among new notifications".

- If there is nothing to report, it stays quiet
- Results pile up in the session you choose
- After repeated failures it stops automatically and warns you (so it does not keep failing unnoticed)

Because it runs unattended, its permissions are separate from chat and stricter by default.

::: warning Watch the cost of leaving it running
HEARTBEAT calls the API periodically. Decide on the interval and permissions before turning it on.
:::
