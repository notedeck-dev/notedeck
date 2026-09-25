---
sourceHash: f28e191a8d71
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

## 2. Make it remember

Say "remember this" and it goes into a memo that **survives closing the conversation**. From then on, it answers with that in mind.

## 3. Hand over the deck

The AI does not just look at the screen; it can operate the deck itself.

- "Put notifications and home side by side" → the columns are laid out
- "I don't need renotes in this column" → a filter is applied
- "Switch to my alt account" → the account is switched

Places the AI touched flash briefly. You can learn the app in this order: **say what you want in words before you memorize where the menu is**.

## 4. It gets to know you

NoteDeck keeps the notes that flow past on your device, and [search](/en/docs/guide/search) lets you go back through them across servers. Connect the AI to that and it **can answer "who was talking about that last week?"**. Only the side that holds the history locally can do this.

There is no need to enter your preferences in a settings screen. Your record of use becomes your profile as it is.

## 5. Give it a persona

Write a role or tone into a skill and it behaves that way from then on. No more typing "keep it short" every time.

Go further and **the AI rewrites its own skills**. It adds the preferences it picked up from conversations to its own settings.

## 6. Have it design the look

"Make a theme with sunset colors" creates and applies one on the spot. "A bit darker" fixes it, and you can always revert.

## 7. Have it build tools

This is where it really starts.

- "Add a button to the note menu that does X" → a plugin
- "I want a small panel that shows X" → a widget
- "I don't want to see notes like this" → a column filter

**It does not have to work on the first try.** The AI finds mistakes in the code it wrote, fixes them and repeats until it works. You can look inside what it made, or [rewrite it yourself](/en/docs/dev/).

::: tip You will be asked for permission
Before impactful actions such as building tools or posting, a confirmation appears. Read it before allowing.
:::

## 8. Bring in information from outside

Register connections to external services and the AI can fetch information from them: weather, calendars, other services you use. It can also build **tools that use the information it fetched**.

## 9. Drive it from outside

It works the other way too. While the app is running, NoteDeck opens an entrance only inside your own machine, so terminals and other apps can call its commands. It cannot be reached from outside networks.

This is where the tools from step 7 pay off. **Once built, they can be called from any entrance** — asking the AI, the command palette, a keyboard shortcut, or an external script.

## 10. Let it mind the house

Turn on [HEARTBEAT](/en/docs/guide/ai#running-while-you-are-away-heartbeat) and the AI runs on its own periodically. Besides keeping watch like "only tell me about important notifications", it can **run the tools you had it build on a schedule**.

If there is nothing to report, it stays quiet.

## 11. The loop starts turning

Once you get here, the loop closes.

It wakes up periodically to check → writes down what it noticed in a memo → reads that and decides "a tool like this would help" → builds it and fixes it until it works → uses it on the next scheduled run → the result goes back into a memo.

**Your environment grows in places you never gave instructions for.** This is the state NoteDeck is aiming for.

---

## About going back

The further you go, the more the AI can do, but **you can step back from any stage**.

- Permissions can be tightened at any time (effective immediately)
- Whatever the AI made or rewrote keeps a history and can be reverted
- Turn off a skill and that persona is gone
- Scheduled runs can be stopped (they also stop automatically after repeated failures)

## Things to keep in mind as you go

- **Open permissions only when you need them** — the defaults are conservative
- **Read the confirmation dialogs** — actions that reach outside stop there
- **Scheduled runs cost money** — decide on the interval before turning them on
- **Look at what it built at least once** — you will learn what to ask for next
