---
sourceHash: 6505c119cecc
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

Because of how Misskey works, the app cannot finish registering for push notifications on its own. Once per account, you run a code in Scratchpad in that server's Web UI. Accounts on the same server can be registered with a single code.

1. Open "Push notifications" from the account menu on the navigation bar and press "Turn on". If no push notification app is installed, a button opens where to get one. If you have more than one, a screen asks which one to use
2. Press "Copy and open Scratchpad"
3. In the browser that opens, make sure you are logged in as the account you are registering. Select everything in Scratchpad and paste the code (if it is empty, long-press to paste), then press ▶ right below the code
4. When it says the account is turned on, you are done in the browser. Within a few minutes a notification says push notifications now arrive. For other accounts on the same server, switch to each in the browser and press ▶ the same way

- There is nothing to paste back into NoteDeck. It turns on when the first push notification arrives, and you can close the screen while waiting
- How fast notifications arrive depends on the push notification app and its delivery server. It does not work if the server has no Web Push configured. If the push notification app's server is self-hosted or only on your home network, the Misskey server may not be able to reach it
- If the push notification app's or the server's registration changes, or notifications don't seem to arrive by push, an app notification asks you to register again. Pressing it opens the same screen; press "Turn on" again
- To start over, press "Start over" on that row. To stop, press "Turn off". Deleting an account or logging out also unregisters it
- The registration (where pushes go and the keys) stays on the device and is not included in backups. To hand it to Scratchpad, it is also kept for a while in that account's Misskey registry (NoteDeck's own area: other apps cannot read it, and you can see it in the Web UI), and removed when registration finishes, when you start over, or when you turn it off

### The code you run in Scratchpad

The code contains neither where pushes go nor the keys. Only a passphrase (a string no one can guess) and the list of target accounts change each time. The code looks up, by the passphrase, the pending entry NoteDeck wrote to the registry, and registers only when there is exactly one and no other done or withdrawn mark. A pending entry slipped in by another app does not get through. Running an old code only prints one line in the output and changes nothing.

You can read [the full code in the repository](https://github.com/notedeck-dev/notedeck/blob/main/crates/notecore/tests/fixtures/push_register_code.is) (the passphrase and the list there are sample values).

## Use Misskey's own Web Push

If you want instant notifications without a push notification app, add the Misskey web to your phone's home screen to receive Misskey's own Web Push. You may get notifications from both it and NoteDeck.
