---
sourceHash: 960d75866506
---

# Supported servers

NoteDeck supports upstream Misskey and the forks that still call themselves Misskey. Forks that became something else by name (Sharkey, CherryPick, Iceshrimp and so on) are not supported. The login screen shows what kind of server you are connecting to, and says so when it is unsupported.

## Servers we support

| Server | Notes |
|---|---|
| Misskey (upstream) | The baseline for every feature |
| Misskey.io | Fork-specific features are listed below |
| yamisskey | Yami timeline / yami mode |
| Misskey tempura | Semi-public visibility / quote list / reactions with remote emoji |
| hanamisskey | Hanami timeline / hanami search / hana mode |

Small forks that are not on this list are treated as upstream. Anything that works through the same API as upstream keeps working.

## Fork-specific features

NoteDeck never changes its behaviour based on a fork's name. It looks at what the server returns (the endpoint list, role policies, server metadata) to tell whether a feature exists, and only then shows the entry point.

### Works on any fork automatically

- **Custom timelines** (yami TL, hanami TL, bubble TL and so on): they appear in the column picker on their own
- **Modes** (yami mode, hana mode): a toggle in the post form and a badge on notes
- **Timeline filters** (hide bots, hide sensitive and so on): only the ones the server accepts are shown
- **Visibility restrictions**: visibilities your role cannot use disappear from the picker

### Per fork

| Server | Feature | Status |
|---|---|---|
| Misskey.io | Media timeline | The social timeline with the "with files" filter gives the same result. There is no dedicated column |
| Misskey tempura | Semi-public (public, non-LTL) | Implemented. Accounts allowed to post it get the option, and notes carry a dedicated icon. Replies and renotes inherit the original visibility (pending verification on a real server) |
| Misskey tempura | Quote list | Implemented. Note details get a "Quotes" tab (pending verification on a real server) |
| Misskey tempura | Reactions with remote emoji | Works |
| hanamisskey | Hanami timeline | Works |
| hanamisskey | Hanami search | Works. Server search is swapped for hanami search |
| hanamisskey | Hana mode | Implemented (pending verification on a real server) |
| yamisskey | Yami timeline / yami mode | Implemented (pending verification on a real server) |

### Deliberately not supported

- **Misskey.io dimensions (choosing a dimension for a timeline column)**: the server forgets dimensions after a short while by design, which does not fit a column you keep open. Dimension input in the post form and a dimension badge on notes may follow on request ([#1201](https://github.com/notedeck-dev/notedeck/issues/1201))
- **Merging the hana mode and semi-public displays**: both mean "public but not on the local timeline", but hana mode is a user state while semi-public is chosen per note. Folding them into one display would hide which one was used, so they stay separate
- **Forks that changed their name**: the support surface would grow beyond what can be maintained

## Things to know (server-side behaviour)

These can look like NoteDeck bugs but are how the server works.

- **Misskey.io** has no chat API. The chat column cannot be used
- **yamisskey** returns no notes to anyone who is not logged in. Guests see nothing. Public posting and federation may require a role on that server
- **Misskey tempura** leaves other people's semi-public notes out of reply lists, renote lists and server search. They stream into the social timeline in real time but disappear when it is reloaded
- **hanamisskey** does not serve featured notes without a login

## Requests and unsupported features

The per-fork inventory of fork-specific features, and the candidates not yet supported, live in tracking issues on GitHub. Comment there if you want something supported.

- [Misskey.io](https://github.com/notedeck-dev/notedeck/issues/1101)
- [Misskey tempura](https://github.com/notedeck-dev/notedeck/issues/1199)
- [hanamisskey](https://github.com/notedeck-dev/notedeck/issues/1200)
- [yamisskey](https://github.com/notedeck-dev/notedeck/issues/1264)
