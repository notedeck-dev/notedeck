---
sourceHash: a9c742f4b4e2
---

# Profiles

A profile is **a saved arrangement of your columns**. Make one per purpose and switch with one click.

It is not the same as a "profile" in the sense of user information. In Japanese, NoteDeck calls the app feature プロファイル and Misskey user information プロフィール; in English both are "profile", and on these pages "profile" means the column arrangement unless it says otherwise.

## When to use them

- **Everyday** — home, notifications, messages
- **Events** — a specific channel side by side with a hashtag search
- **Work** — AI, memos, client search

When what you want to see changes with the situation, you no longer have to add and remove columns each time.

## Switching and managing

Just pick one from the list in the profile menu (single key `g`) and the whole deck is swapped. You can also switch directly with `Alt+1` to `Alt+9`, or from a [`notedeck://profile/<name>`](/en/docs/guide/links) link. Creating and deleting are done from the same menu; editing the name and other details happens in the profile editor.

What gets saved is which columns are lined up, in what order and at what width, plus the position and size of popped-out OS windows. The [navbar](/en/docs/deck/navbar)'s button layout is independent of profiles and does not change when you switch. Accounts themselves are not tied to profiles; every account you have added is available in every profile.

On first launch you start with a profile holding the default column layout.

## Relationship with windows

Profiles and windows are separate axes.

- **Profile** = the owner of a column layout
- **Window** = where it is shown

You can open the same profile in several windows. Add a column in one, and it appears in every window showing that profile. Closing a window does not change the profile's contents.
