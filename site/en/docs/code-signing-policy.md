---
sourceHash: 93a1fdd04990
---

# Code signing policy

This page describes how the Windows builds of NoteDeck are code-signed.

::: warning Current status
Our application to SignPath Foundation is pending. Until it is approved, the Windows builds are distributed unsigned (see [Warning on first launch](/en/docs/install#warning-on-first-launch)). Releases after approval will be signed as described below.
:::

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

- Only Windows artifacts built from the source in this [public repository](https://github.com/notedeck-dev/notedeck) are signed: the installer, the application itself, the bundled `notemaid`, and the standalone `notecli`
- Builds are produced by the GitHub Actions release workflow ([`release.yml`](https://github.com/notedeck-dev/notedeck/blob/main/.github/workflows/release.yml)) from a version tag. Following the release procedure, tags are placed on commits that have been merged into `main`. Binaries built on a developer's machine are never signed
- We never sign binaries made by third parties under this project's name
- Every signing request is checked and approved by an approver listed below, once per release

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [hitalin](https://github.com/hitalin) |
| Approvers | [hitalin](https://github.com/hitalin) |

Only the members above can write to the repository. Changes from anyone else arrive as pull requests and are reviewed by a member before they are merged. Multi-factor authentication is required for the members' GitHub accounts.

## Privacy

NoteDeck sends no usage statistics, crash reports or advertising traffic, and there is no path by which the developers receive users' data. Its communication with other systems is mainly the following:

- With the Misskey servers the user has logged in to
- To fetch images and other media contained in notes and profiles (from the servers that host them)
- With the AI providers and external services the user has configured (only when those features are used)
- To check for updates (GitHub Releases)
- To fetch previews of URLs contained in notes (can be turned off in settings)
- To fetch the store listing and items (`store.notedeck.io`), pets (`petdex.dev`), icons and web fonts
- Communication performed by plugins and widgets the user has installed

The complete list of destinations is in the [privacy policy](/en/docs/privacy).

## Reporting problems

If you find a problem with a signed build, tell us through [GitHub issues](https://github.com/notedeck-dev/notedeck/issues). For vulnerabilities, please use a [private report](https://github.com/notedeck-dev/notedeck/security/advisories/new) instead of a public issue.
