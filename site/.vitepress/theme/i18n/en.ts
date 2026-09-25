// 原文 ja.ts から訳した時点のハッシュ。docs-lint が訳の置き去りを検出する (#1145)
// sourceHash: 22006b6e92e6

import type { Messages } from './ja'

const en: Messages = {
  nav: {
    docs: 'Docs',
    why: 'Why',
    features: 'Features',
    download: 'Download',
    menu: 'Menu',
    colorMode: 'Toggle color mode',
    language: 'Language',
  },
  release: {
    latest: 'See the latest release',
    released: (tag: string) => `${tag} is out`,
  },
  hero: {
    desc: 'The unofficial client for Misskey power users.',
    download: 'Download',
    tryGuest: 'Try without logging in',
    screenshotAlt: 'The NoteDeck deck — columns laid out side by side',
  },
  keyFeatures: [
    {
      icon: '🗂️',
      title: 'Every server, one screen',
      lead: 'Notifications, timelines and search, ',
      leadStrong: 'merged across accounts.',
      body: 'misskey.io, nijimiss, sushi.ski — however many servers you are on, keep track of them in a single deck. Assigning a different account to each column is something the deck in Misskey Web cannot do.',
    },
    {
      icon: '💾',
      title: 'Notes you have seen stay with you',
      lead: 'Every note that scrolls past, ',
      leadStrong: 'the app remembers for you.',
      body: 'Timelines are saved to a local database automatically, so "where was that note?" is one full-text search away. Read them again offline, and keep them even after they disappear from the server.',
    },
    {
      icon: '⚡',
      title: 'Light and fast',
      lead: 'Not a browser — ',
      leadStrong: 'a native app built with Rust.',
      body: 'Cold start in under a second, instant resume from the tray, smooth scrolling and easy on the battery. No browser tab left open, no heavy runtime.',
    },
  ],
  guest: {
    title: 'Try it without logging in',
    lead: 'Add a guest account to browse public content without signing up anywhere.',
    canLabel: 'You can',
    cannotLabel: 'You cannot',
    can: [
      'Read public timelines (local, global and more)',
      'Browse public channels, gallery posts and pages',
      'Look at server info, custom emoji and federation charts',
      'Use local tools such as themes and widgets',
    ],
    cannot: [
      'Post, react or follow',
      'Receive notifications',
      'Manage drive, lists, antennas or clips',
    ],
    foot: 'What you can see depends on each server’s visibility settings. To stop, just “Remove guest” — no sign-up, no email address.',
  },
  features: {
    title: 'Features',
    deck: {
      chip: 'Deck UI',
      title: 'Your own layout, arranged your way',
      body: 'Home, local, notifications, search, lists, antennas, channels, chat — line up any column side by side. Drag to resize, then save the arrangement as a “profile” and switch with one click.',
      list: [
        'More than 16 column types',
        'Unified notifications and search across accounts',
        'Pop a column out into its own window',
        'Picture-in-picture (always on top) for multi-monitor setups',
      ],
    },
    offline: {
      chip: 'Works offline',
      title: 'Notes that scrolled by stay here',
      body: 'Notes from your timelines are stored in a local SQLite database automatically. Even if a note is deleted on the server or federation breaks, your copy stays.',
      list: [
        'Find past notes instantly with full-text search',
        'Offline mode to save battery',
        'Back up everything by copying one DB file',
        'Your posts stay with you even if the server goes away',
      ],
    },
    security: {
      chip: 'Peace of mind',
      title: 'Your OS guards your login',
      body: 'Access tokens are not kept in browser storage but encrypted in your OS keychain (macOS Keychain, Windows Credential Manager and so on). Nothing is stored in plain text inside the app.',
      list: [
        'Encrypted in the OS keychain',
        'Tokens are wiped from memory after use',
        'The local API blocks requests from websites',
      ],
      policyHtml:
        'Details are public in <a href="https://github.com/notedeck-dev/notedeck/blob/main/SECURITY.md">SECURITY</a>',
    },
  },
  more: {
    title: 'And more',
    keyboard: {
      title: 'Keyboard first',
      body: 'Search and run more than 30 commands from the command palette (Ctrl+K). Every keybinding can be customized.',
    },
    bossKey: {
      title: 'Boss Key & Quick Note',
      body: 'Ctrl+Shift+B hides the window instantly. Ctrl+Alt+N posts from anywhere. Global hotkeys only a desktop app can offer.',
    },
    mfm: {
      title: 'MFM and math',
      body: 'Full support for MFM, Misskey’s markup syntax, plus clean rendering of math (KaTeX) and highlighted code.',
    },
    preview: {
      title: 'Paste a URL, get a preview',
      body: 'Dedicated previews for 16 sites including YouTube, Spotify, Niconico, Pixiv and Amazon. Just paste the link.',
    },
    forks: {
      title: 'Works with forks',
      body: 'Supports upstream Misskey and forks that still call themselves Misskey. The server type is detected automatically and fork-specific timelines just work.',
    },
    appearance: {
      title: 'Make it look like yours',
      body: 'Use Misskey themes as they are and set a deck wallpaper. Automatic dark/light switching, gestures and native OS notifications included.',
    },
    ads: {
      title: 'Good to your server',
      body: 'One of the few third-party clients that shows server ads properly, at the frequency the server configures.',
    },
    data: {
      title: 'Your data is yours',
      body: 'Back up everything by copying the DB file. Export and import your settings, and choose to keep your data after logging out.',
    },
    perf: {
      title: 'Choose how light it runs',
      body: 'Switch presets from low-memory to high-performance. The frame rate adapts to your device automatically.',
    },
  },
  ide: {
    title: 'It is actually an “IDE”',
    descHtml:
      'Under the hood, NoteDeck is a <strong>Misskey Integrated Deck Environment</strong>',
    store: {
      title: 'Restyle and extend from the store',
      strong: 'Plugins, themes and widgets in one click. ',
      bodyHtml:
        'Install them straight from <a href="https://store.notedeck.io">misstore</a>, the dedicated store, and turn each one on or off per account. A built-in AiScript editor with live preview runs what you write on the spot.',
    },
    ai: {
      title: 'AI that lives in your deck',
      strong: 'A partner for summaries, posts and reactions. ',
      body: 'A dedicated AI chat column plus AI actions right from the note menu. It always asks before writing anything, so it never acts on its own, and it can check in periodically while you are away. Pick from Anthropic, OpenAI, xAI, Google, OpenRouter and more. Entirely optional — it only turns on when you connect your own API key, and everything else works without it.',
    },
    inspect: {
      title: 'See everything inside',
      strong: 'Watch how Misskey works behind the scenes. ',
      body: 'Built-in inspectors show traffic with the server in real time, and a raw JSON view shows each note as data. Sensitive fields are masked automatically. The fastest way to learn how Misskey works.',
    },
    openTitle: 'An open box, not a closed one',
    openLead: 'It does not stop at what ships. It grows in the hands of the people who use it.',
    extend: {
      title: 'Extend it yourself',
      strong: 'Write a new command and it becomes part of your deck. ',
      body: 'Commands written in AiScript show up in the command palette right away and double as tools for the AI. Bring in outside services like translation, weather or GitHub. Services that need a key can be registered safely, and their secrets are never shown to the AI.',
    },
    grow: {
      title: 'Grows with your AI',
      strong: 'The more you use it, the more it becomes your own tool. ',
      body: 'From themes and keybindings to the AI’s own persona, the AI edits them straight from the conversation. It also operates the UI for you — adding columns, switching accounts — and highlights where it acted. What it learns carries over to the next conversation.',
    },
    api: {
      title: 'Drive it from outside',
      strong: 'Hardware buttons, CLIs and AI, all through one entrance. ',
      body: 'Control the whole deck through the local API — posting, fetching timelines, managing columns. Write it once and call it from Raycast, Obsidian, Stream Deck or an AI agent.',
    },
  },
  developers: {
    title: 'For developers',
    desc: 'NoteDeck is open source (AGPL-3.0). It uses Vue 3 + TypeScript like upstream Misskey, so if you can read the Misskey codebase, you can read this one.',
    device: {
      label: 'Your device',
      desc: 'OS integration and the client layer: windows, tray, OS notifications, keychain, auto-update. The WebView only ever talks to the local Rust side, which decides whether data calls go straight to notecore or are relayed to notecored.',
    },
    frontend: {
      label: 'Frontend',
      desc: 'The deck UI. It does not know where the core is running.',
      vaporTag: 'Vapor-ready',
    },
    remote: {
      label: 'Your own server (optional)',
      desc: 'Always-on, RPC/SSE and pairing: a shell that runs notecore headless. Route through it and everything from notecore down runs on your server — archiving, notifications and AI keep going with your devices closed, and several devices share the same deck.',
    },
    core: {
      label: 'Core',
      desc: 'The domain that does not depend on Tauri: vault, query runtime, AI agent loop, settings, authorization, caches. It only holds work that makes sense with no device connected, and it is the same crate whichever shell wraps it.',
    },
    client: {
      label: 'Misskey client',
      desc: 'Misskey API, WebSocket streaming, SQLite (FTS5). It knows nothing about NoteDeck and runs on its own as a library or a CLI.',
    },
    forkTitle: 'Bring your server’s features to NoteDeck',
    forkBodyHtml:
      'Differences between forks are handled by <strong>adapters</strong>. Tell us about features that do not work yet (forks that still call themselves Misskey).',
    forkButton: 'Request support',
  },
  download: {
    title: 'Download',
    desc: 'Install it for your platform',
    comingSoon: 'Coming soon',
    unsigned:
      'The Windows and macOS builds are not code-signed yet, so you will see an “unknown publisher” warning on first launch.',
    unsignedLink: 'Help us get rid of the warning',
    packageManagers: 'Package managers',
    copied: 'copied!',
    clickToCopy: 'click to copy',
    storeTitle: 'Toward warning-free store releases',
    storeLead:
      'Both the “unknown publisher” warning on desktop and official releases on Google Play and the App Store are blocked by paperwork, not technology: the project needs to be known, and developer accounts cost money. We would like to get over these with the community.',
    star: {
      title: 'Star us on GitHub',
      body: 'SignPath Foundation, which offers free code signing for open source on Windows, will not sign code nobody knows about — its review looks at real-world usage. Stars and download counts count directly. It is the easiest boost, one click away.',
      button: 'Star on GitHub',
    },
    beta: {
      title: 'Beta testers wanted',
      body: 'For personal developer accounts created on or after November 13, 2023, Google Play requires a closed test with at least 12 testers opted in for 14 consecutive days before granting production access. We are looking for people who can try it on real devices and share feedback.',
      button: 'Apply as a tester',
    },
    sponsor: {
      title: 'Support development',
      body: 'Funds go to the Google Play ($25 registration) and Apple Developer Program ($99/year) accounts, test devices, and keeping releases going. The same Apple Developer Program is required for notarization, which removes the macOS Gatekeeper warning.',
      button: 'GitHub Sponsor',
    },
  },
}

export default en
