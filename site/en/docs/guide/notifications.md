---
sourceHash: be6db22249b0
---

# Receiving notifications

Notifications arrive differently depending on whether the app is open.

| State | How they arrive |
|---|---|
| **App open** | Right away. NoteDeck keeps a live connection to each server, and notifications for accounts you are not looking at show up as OS notifications |
| **App closed (Android)** | NoteDeck checks periodically and shows what arrived. This can be delayed while the device is saving power. With a push notification app they arrive right away ([Receive push notifications](#receive-push-notifications-android)) |
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

## Receive push notifications (Android)

With a push notification app (one that supports UnifiedPush, such as ntfy), notifications arrive right away while NoteDeck is closed. You choose per account. Without one, NoteDeck still checks periodically while closed.

Because of how Misskey works, the app cannot register for push notifications by itself. You do it once per account in the Web UI.

1. Open "Push notifications" from the account menu on the navigation bar and press "Start registering". If you have more than one push notification app, a screen asks which one to use
2. Press "Copy code", then "Open Scratchpad", paste the code into Scratchpad in the Web UI and run it. Log in to the Web UI as that account first
3. Copy what it shows, paste it into NoteDeck, and press "Register"

- How fast notifications arrive depends on the push notification app and its delivery server. It does not work if the server has no Web Push configured
- If the push notification app's registration changes, the account menu says "register again". Repeat the same steps
- To stop, press "Stop push notifications" on the same screen. Deleting an account or logging out also unregisters it
- The registration (where pushes go and the keys) stays on the device and is not included in backups

## Use Misskey's own Web Push

If you want instant notifications without a push notification app, add the Misskey web to your phone's home screen to receive Misskey's own Web Push. You may get notifications from both it and NoteDeck.
