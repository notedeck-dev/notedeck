---
sourceHash: 026b805577d5
---

# Growing your environment

The AI you connected in [Using AI](/en/docs/guide/ai) is not just something that answers questions. The more you use it, the more it reshapes NoteDeck itself.

This page describes where that leads and the stages along the way, in order. **You do not have to do all of it from the top.** Stop wherever you like, and you can always go back.

## Where it leads

- Ask for your deck to be rearranged instead of hunting for buttons
- It has a grasp of your interests from what you have seen and reacted to
- Tools you never wrote yourself have quietly appeared
- It keeps an eye on things without being asked and only tells you when needed

An ordinary client can only be used within the features its developers built. NoteDeck grows into a different shape for each person who uses it.

---

## 1. Talk to it

Open an AI column and ask about the notes visible on screen. Summaries, translations, "what is going on in this thread?".

The AI knows **what you are looking at right now**, so there is no need to paste URLs or copy text.

Even without an API key, if you have an AI CLI logged in on your machine you can start using it [as the AI as it is](/en/docs/guide/ai#making-a-local-cli-the-ai).

## 2. Make it remember

Say "remember this" and the AI files it according to what it is. How to address you and how you like it to talk go under "What it remembers about you", small facts and decisions go into its own **notes to self**, and longer pieces of text go into a memo. **None of it disappears when you close the conversation.** Memory takes effect from the next conversation, and memos are searched and read by the AI when it needs them.

You can read what it remembers under "Memory" (メモリー) in the Agent settings at any time, and fix or delete it line by line.

## 3. Hand over the deck

The AI does not just look at the screen; it can operate the deck itself.

- "Put notifications and home side by side" → the columns are laid out
- "Rename this column and make it a bit wider" → the settings change
- "Switch to my alt account" → the account is switched

Places the AI touched flash briefly. You can learn the app in this order: **say what you want in words before you memorize where the menu is**.

## 4. It gets to know you

NoteDeck keeps the notes that flow past on your device, and [search](/en/docs/guide/search) lets you go back through them across servers. Connect the AI to that and it **can answer "who was talking about that last week?"**. Only the side that holds the history locally can do this.

There is no need to enter your preferences in a settings screen. Your record of use becomes your profile as it is. Tell it how to address you or how you like it to talk during a conversation and the AI writes that down under "About you". If you would rather it did not remember, you can turn that off.

## 5. Give it a persona

The AI has a **core personality** that stays the same even when you switch characters. On top of it you can dress it in a tone or a role (a character), so you never have to type "keep it short" again. The first time you talk to it, you can decide its name and vibe together (it will not ask unless you do).

Go further and **the AI proposes changes to its own personality and notes to self**. It adds the preferences it picked up from conversations to its own settings. Only the core changes when you approve it.

## 6. Have it design the look

"Make a theme with sunset colors" creates and applies one on the spot. "A bit darker" fixes it, and you can always revert. To let it make themes, allow theme writes in the permissions (off by default).

## 7. Have it build tools

This is where it really starts.

- "Add a button to the note menu that does X" → a plugin
- "I want a small panel that shows X" → a widget
- "Make a condition that hides notes like this" → a column query (turn the result on in the filter menu of the column that should use it)

**It does not have to work on the first try.** The AI finds mistakes in the code it wrote, fixes them and repeats until it works. You can look inside what it made, or [rewrite it yourself](/en/docs/dev/) (install the author skill from MisStore and the AI reads it while writing).

::: tip You will be asked for permission
Before impactful actions such as building tools or posting, a confirmation appears. Read it before allowing.
:::

## 8. Bring in information from outside

Register connections to external services and the AI can fetch information from them: weather, calendars, other services you use. It can also build **tools that use the information it fetched**.

## 9. Drive it from outside

It works the other way too. While the app is running, NoteDeck opens an entrance only inside your own machine, so terminals and other apps can call its commands. It cannot be reached from outside networks. External AI agents reach it through [MCP](/en/docs/guide/ai#using-notedeck-from-an-external-ai-agent-mcp), browsers and launchers through [`notedeck://` links](/en/docs/guide/links), and while you are in another app, through [system-wide hotkeys](/en/docs/guide/keyboard).

This is where the tools from step 7 pay off. **Once built, they can be called from any entrance** — asking the AI, the command palette, a keyboard shortcut, or an external script.

## 10. Let it mind the house

Turn on [HEARTBEAT](/en/docs/guide/ai#running-while-you-are-away-heartbeat) and the AI runs on its own periodically. Besides keeping watch like "only tell me about important notifications", it can **run the tools you had it build on a schedule**.

If there is nothing to report, it stays quiet. When it has something to tell you it lands in app notifications, and if you make it [resident](/en/docs/notemaid#making-it-resident) it keeps going while the app is closed. It does not run on a connection where a local CLI is the AI.

## 11. The loop starts turning

Once you get here, the loop closes.

It wakes up periodically to check → writes down what it noticed in its notes to self → reads that and decides "a tool like this would help" → builds it and fixes it until it works → uses it on the next scheduled run → the result goes back into its notes to self.

**Your environment grows in places you never gave instructions for.** This is the state NoteDeck is aiming for.

---

## About going back

The further you go, the more the AI can do, but **you can step back from any stage**.

- Permissions can be tightened at any time (effective immediately)
- Whatever the AI made or rewrote keeps a history and can be reverted
- Turn off the character skill and the tone and role go back. The core personality is only ever what you approved
- Scheduled runs can be stopped (they also stop automatically after repeated failures)

## Things to keep in mind as you go

- **Open permissions only when you need them** — the defaults are conservative
- **Read the confirmation dialogs** — actions that reach outside stop there
- **Scheduled runs cost money** — decide on the interval before turning them on
- **Look at what it built at least once** — you will learn what to ask for next
