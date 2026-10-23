---
sourceHash: 3eeceeacd9b7
---

# Receiving notifications

Notifications arrive differently depending on whether the app is open.

| State | How they arrive |
|---|---|
| **App open** | Right away. NoteDeck keeps a live connection to each server, and notifications for accounts you are not looking at show up as OS notifications |
| **App closed (Android)** | NoteDeck checks periodically and shows what arrived. This can be delayed while the device is saving power |
| **App closed (desktop)** | They do not arrive. Only while the app is open |

## When notifications become read

Notifications become read when you look at a notifications column. Fetching them or merely opening the app does not mark them read, so the unread badge on the Misskey web UI and on other devices stays until you look.

While a notifications column is visible, notifications for that account are not shown as OS notifications (the in-app view is enough). Notifications for other columns, or for accounts without a notifications column, are shown as OS notifications.

## Per-type sound and display (Android)

The OS notification settings list one channel per type:

- Mentions & replies
- Reactions & renotes
- Follows
- Post notifications (posts by specific users)
- Account (login alerts and similar)
- Other (achievements, poll results)
- Messages

Changing sounds, silencing a type, or showing without sound is done in the OS settings. NoteDeck has no notification settings screen of its own. Which types you receive at all follows your Misskey server's notification settings.

## Notification permission (Android)

Right after you add your first account, NoteDeck explains how notifications work and asks for the permission. If you declined and want them later, use "Open OS notification settings" in the account menu on the navigation bar.

## Instant notifications while closed

NoteDeck does not deliver instant notifications while it is closed. If you need them, add the Misskey web UI to your phone's home screen; the server's own Web Push will reach you there. These may overlap with NoteDeck's notifications.
