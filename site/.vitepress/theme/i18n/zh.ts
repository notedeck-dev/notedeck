// 原文 ja.ts から訳した時点のハッシュ。docs-lint が訳の置き去りを検出する (#1145)
// sourceHash: 744d7c22947c

import type { Messages } from './ja'

const zh: Messages = {
  nav: {
    docs: '文档',
    why: '特色',
    features: '功能',
    download: '下载',
    menu: '菜单',
    colorMode: '切换颜色模式',
    language: '语言',
  },
  release: {
    latest: '查看最新版本',
    released: (tag: string) => `${tag} 已发布`,
  },
  hero: {
    desc: '面向 Misskey 重度用户的非官方客户端。',
    download: '下载',
    tryGuest: '不登录试用',
    screenshotAlt: 'NoteDeck 的 Deck 界面 — 多个列横向排列的布局',
  },
  keyFeatures: [
    {
      icon: '🗂️',
      title: '所有服务器，尽在一屏',
      lead: '通知、时间线与搜索，',
      leadStrong: '跨账户汇总一览。',
      body: 'misskey.io、nijimiss、sushi.ski — 无论你在多少个服务器上，都能在一个 Deck 里统一掌握。为每个列分配不同的账户，这是 Misskey 网页版的 Deck 做不到的。',
    },
    {
      icon: '💾',
      title: '看过的帖子，留在手边',
      lead: '刷过去的每一条帖子，',
      leadStrong: '应用都会自动记住。',
      body: '时间线会自动保存到本地数据库。“那条帖子在哪来着？”全文搜索一下就能找到。没有网络也能重读，即使从服务器上消失，本地也依然保留。',
    },
    {
      icon: '⚡',
      title: '轻量，快速',
      lead: '不是浏览器，',
      leadStrong: '而是用 Rust 打造的原生应用。',
      body: '冷启动不到 1 秒，从托盘恢复瞬间完成。滚动流畅，也更省电。无需一直开着浏览器标签页，也没有沉重的运行时。',
    },
  ],
  guest: {
    title: '无需登录，即可试用',
    lead: '添加访客账户后，无需在任何地方注册即可浏览公开内容。',
    canLabel: '可以做的',
    cannotLabel: '不能做的',
    can: [
      '浏览公开时间线（本地、全局等）',
      '浏览频道、图集、页面等公开内容',
      '查看服务器信息、自定义表情符号和联合图表',
      '使用主题、小工具等本地工具',
    ],
    cannot: ['发帖、回应、关注', '接收通知', '管理网盘、列表、天线、便签'],
    foot: '可浏览的范围取决于各服务器的公开设置。不想用时只需“删除访客” — 不需要注册账户，也不需要邮箱地址。',
  },
  features: {
    title: '功能',
    deck: {
      chip: 'Deck UI',
      title: '自由排列，专属于你的布局',
      body: '首页、本地、通知、搜索、列表、天线、频道、聊天 — 任意列都能横向排开一览。拖动即可调整宽度，排列方式可保存为“配置文件”，一键切换。',
      list: [
        '16 种以上的列类型',
        '统一显示多个账户的通知与搜索',
        '将列弹出为独立窗口',
        '画中画（始终置顶的小窗口），善用多显示器',
      ],
    },
    offline: {
      chip: '离线也能用',
      title: '刷过的帖子，也会留在这里',
      body: '时间线上出现的帖子会自动存入本地 SQLite。即使帖子从服务器上删除，或联合中断，本地的数据也会一直保留。',
      list: [
        '用全文搜索瞬间找到过去的帖子',
        '切换离线模式以节省电量',
        '复制一个数据库文件即可完整备份',
        '即使服务器消失，你的帖子也留在手边',
      ],
    },
    security: {
      chip: '安心',
      title: '登录信息，由操作系统守护',
      body: '作为账户钥匙的令牌不保存在浏览器存储中，而是加密保管在操作系统的钥匙串（macOS 钥匙串、Windows 凭据管理器等）里。应用内不以明文存放。',
      list: [
        '在操作系统钥匙串中加密保管',
        '用完的令牌也会从内存中清除',
        '本地 API 拦截来自外部网站的访问',
      ],
      policyHtml:
        '防护措施的详情公开在 <a href="https://github.com/notedeck-dev/notedeck/blob/main/SECURITY.md">SECURITY</a>',
    },
  },
  more: {
    title: '还有更多',
    keyboard: {
      title: '键盘全搞定',
      body: '在命令面板（Ctrl+K）中搜索并执行 30 个以上的命令。所有快捷键都可以自定义。',
    },
    bossKey: {
      title: 'Boss Key & Quick Note',
      body: 'Ctrl+Shift+B 瞬间隐藏窗口。Ctrl+Alt+N 在任何界面立即发帖。全局热键是桌面应用才有的能力。',
    },
    mfm: {
      title: 'MFM 和数学公式',
      body: '完整支持 Misskey 独有的文字修饰语法 (MFM)，数学公式（KaTeX）和代码高亮也能漂亮地显示。',
    },
    preview: {
      title: '贴上 URL 即可预览',
      body: '为 YouTube、Spotify、Niconico、Pixiv、Amazon 等 16 个网站提供专用预览。只需贴上链接即可丰富展开。',
    },
    forks: {
      title: '也支持分支',
      body: '支持 Misskey 官方版本，以及仍以 Misskey 为名的分支。自动识别服务器类型，分支特有的时间线也能直接使用。',
    },
    appearance: {
      title: '外观随心定制',
      body: '可以直接使用 Misskey 的主题，还能设置 Deck 壁纸。支持深色/浅色自动切换、手势操作以及操作系统原生通知。',
    },
    ads: {
      title: '与服务器共生',
      body: '少数能正确显示服务器广告的第三方客户端之一，显示频率也遵循服务器的设置。',
    },
    data: {
      title: '数据属于你',
      body: '复制数据库文件即可完整备份。支持导出/导入设置，登出后也可以选择保留数据。',
    },
    perf: {
      title: '轻重由你选择',
      body: '通过预设在省内存与高性能之间切换。帧率会根据设备自动优化。',
    },
  },
  ide: {
    title: '其实，它是一个“IDE”',
    descHtml:
      'NoteDeck 的真面目是 <strong>Misskey 集成 Deck 环境</strong> (Integrated Deck Environment)',
    store: {
      title: '在商店里换装和扩展',
      strong: '插件、主题、小工具一键安装。',
      bodyHtml:
        '直接从专用商店 <a href="https://store.notedeck.io">misstore</a> 安装，并按账户分别开关。内置带实时预览的 AiScript 编辑器，自己写的东西当场就能运行。',
    },
    ai: {
      title: 'AI，住在你的 Deck 里',
      strong: '摘要、发帖、回应，都能托付的搭档。',
      body: '除了专用的 AI 聊天列，还能直接从帖子菜单调用 AI 操作。写入之前一定会向你确认，所以不会擅自行动；你不在时也能定期巡查。可以从 Anthropic、OpenAI、xAI、Google、OpenRouter 等中自由选择。是否使用完全由你决定 — 只有接入你自己的 API 密钥时才会启用，没有它其他功能也都能正常使用。',
    },
    inspect: {
      title: '内部，一览无余',
      strong: '原原本本地观察 Misskey 的幕后。',
      body: '内置可实时查看与服务器之间通信的检查器，以及显示帖子原始数据的 Raw JSON 视图。敏感字段会自动遮蔽。这是了解 Misskey 运作机制的捷径。',
    },
    openTitle: '不是封闭的盒子，而是敞开的盒子',
    openLead: '不止于出厂时的功能，而是在使用者手中不断拓展。',
    extend: {
      title: '可以自己扩展',
      strong: '写出新命令，它当场就成为 Deck 的功能。',
      body: '用 AiScript 写的命令会立即出现在命令面板中，也能作为 AI 的工具使用。还能接入翻译、天气、GitHub 等外部服务。需要密钥的服务也能安全登记，密钥内容绝不会被 AI 看到。',
    },
    grow: {
      title: '与 AI 一起成长',
      strong: '越用越成为你专属的工具。',
      body: '从主题、快捷键到 AI 自身的人设，AI 都能在对话中直接编辑。它还能代你执行添加列、切换账户等 UI 操作，并让操作过的位置高亮显示。学到的东西也会延续到下一次对话。',
    },
    api: {
      title: '也能从外部操控',
      strong: '实体按键、CLI 和 AI，都走同一个入口。',
      body: '通过本地 API 操控整个 Deck — 发帖、获取时间线、管理列都可以。写一次，就能从 Raycast、Obsidian、Stream Deck 乃至 AI 智能体中随处调用。',
    },
  },
  developers: {
    title: '致开发者',
    desc: 'NoteDeck 是开源软件 (AGPL-3.0)。与 Misskey 官方一样使用 Vue 3 + TypeScript，能读懂 Misskey 代码的人也能直接读懂它。',
    device: {
      label: '你的设备',
      desc: '操作系统集成 + 客户端层：窗口、托盘、系统通知、钥匙串、自动更新。WebView 只与本地的 Rust 通信，数据类调用交给 notecore，AI 类调用交给 notemaid。',
    },
    frontend: {
      label: '前端',
      desc: 'Deck 的 UI。它并不知道核心运行在哪里。',
      vaporTag: '已为 Vapor 做好准备',
    },
    remote: {
      label: 'AI 进程',
      desc: 'AI（智能体循环 / HEARTBEAT）始终是独立进程。默认由应用启动，并随应用一起退出。将其作为登录时任务常驻后，即使退出应用 HEARTBEAT 也会继续运行。数据留在设备上，notemaid 不会打开帖子数据库。',
    },
    core: {
      label: '核心',
      desc: '不依赖 Tauri 的数据层：缓存数据库、查询运行时、Vault、设置、授权。只负责“即使没有任何设备连接也有意义的处理”，对 AI 一无所知。notemaid 只借用其中的 Vault、授权和设置。',
    },
    client: {
      label: 'Misskey 客户端',
      desc: 'Misskey API、WebSocket 流式传输、SQLite (FTS5)。它不了解 NoteDeck 特有的东西，可以作为库或 CLI 单独运行。',
    },
    forkTitle: '把你所在服务器的独有功能带到 NoteDeck',
    forkBodyHtml:
      '各分支之间的差异由<strong>适配器</strong>负责处理。如果有用不了的独有功能，请告诉我们（对象为仍以 Misskey 为名的分支）。',
    forkButton: '申请支持',
  },
  download: {
    title: '下载',
    desc: '根据你的平台进行安装',
    comingSoon: 'Coming soon',
    unsigned:
      'Windows / macOS 版目前尚未进行代码签名，首次启动时会出现“未知发布者”的警告。',
    unsignedLink: '为了消除警告，我们正在寻求帮助',
    packageManagers: '包管理器',
    copied: 'copied!',
    clickToCopy: 'click to copy',
    storeTitle: '为了无警告地从商店发布',
    storeLead:
      '无论是桌面版的“未知发布者”警告，还是在 Google Play / App Store 上的正式发布，剩下的障碍都不是技术，而是手续：项目需要被人知道，开发者账户也需要费用。我们希望和社区一起跨越这些障碍。',
    star: {
      title: '在 GitHub 上点 Star',
      body: '为 Windows 开源软件提供免费代码签名的 SignPath Foundation 以“无法为无人知晓的源代码签名”为由，会在审核中查看实际使用情况。Star 数和下载量会直接成为依据。点一下就能完成，是最轻松的支持方式。',
      button: '在 GitHub 上 Star',
    },
    beta: {
      title: '招募 Beta 测试者',
      body: 'Google Play 要求 2023 年 11 月 13 日之后创建的个人开发者账户，在获得正式版访问权限之前，必须进行至少 12 名测试者连续 14 天参与的封闭测试。我们正在招募能在真机上试用并提供反馈的朋友。',
      button: '报名成为测试者',
    },
    sponsor: {
      title: '支持开发',
      body: '资金将用于 Google Play（注册费 $25）/ Apple Developer Program（$99/年）的账户费用、测试设备的采购，以及维持持续的发布工作。消除 macOS Gatekeeper 警告所需的公证（notarization）也需要同一个 Apple Developer Program。',
      button: 'GitHub Sponsor',
    },
  },
}

export default zh
