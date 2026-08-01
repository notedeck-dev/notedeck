/**
 * カスタム CSS エディタ (CssEditorContent) のプリセット定義と、
 * プリセット ⇄ CSS テキストの相互変換。
 *
 * CSS 側にはマーカーコメント (`/* nd-font: X *\/` 等) を埋め、コードタブで
 * 直接編集された CSS からも選択状態を復元できるようにしている。
 */

export interface FontOption {
  value: string
  label: string
  /** Google Fonts の既定 URL 以外から取る場合 */
  importUrl?: string
  /** @font-face を直接書く場合 (webfont CDN 配信のフォント) */
  customCss?: string
  /** OS プリインストール前提でダウンロード不要なもの */
  system?: boolean
}

export const FONT_OPTIONS: FontOption[] = [
  { value: '', label: 'デフォルト' },
  { value: 'Noto Sans JP', label: 'Noto Sans JP' },
  { value: 'Noto Serif JP', label: 'Noto Serif JP' },
  { value: 'Sawarabi Gothic', label: 'Sawarabi Gothic' },
  { value: 'Sawarabi Mincho', label: 'Sawarabi Mincho' },
  { value: 'M PLUS 1p', label: 'M PLUS' },
  { value: 'M PLUS Rounded 1c', label: 'M PLUS Rounded' },
  { value: 'M PLUS 2', label: 'M PLUS 2' },
  { value: 'Murecho', label: 'Murecho' },
  { value: 'RocknRoll One', label: 'RocknRoll One' },
  { value: 'Klee One', label: 'Klee One' },
  { value: 'Zen Maru Gothic', label: 'Zen Maru Gothic' },
  { value: 'Kaisei Decol', label: 'Kaisei Decol' },
  { value: 'Yomogi', label: 'Yomogi' },
  { value: 'Kosugi', label: 'Kosugi' },
  { value: 'Kosugi Maru', label: 'Kosugi Maru' },
  {
    value: 'Kiwi Maru',
    label: 'Kiwi Maru',
    importUrl:
      'https://fonts.googleapis.com/css2?family=Kiwi+Maru:wght@300&display=swap',
  },
  { value: 'Hachi Maru Pop', label: 'Hachi Maru Pop' },
  { value: 'Mochiy Pop One', label: 'Mochiy Pop One' },
  { value: 'Mochiy Pop P One', label: 'Mochiy Pop P One' },
  { value: 'Yusei Magic', label: 'Yusei Magic' },
  { value: 'DotGothic16', label: 'Dot Gothic 16' },
  {
    value: '手書き雑フォント',
    label: '手書き雑フォント',
    customCss: `@font-face { font-family: '手書き雑フォント'; src: url('https://cdn.leafscape.be/tegaki_zatsu/851tegaki_zatsu_web.woff2') format("woff2"); font-display: swap; }`,
  },
  {
    value: '瀬戸フォント',
    label: '瀬戸フォント',
    customCss: `@font-face { font-family: '瀬戸フォント'; src: url('https://cdn.leafscape.be/setofont/setofont_web.woff2') format("woff2"); font-display: swap; }`,
  },
]

/**
 * 等幅フォント (#901)。コード/JSON/エディタ系が参照する --nd-font-mono を差し替える。
 * 候補は「Web からそのまま取れる (Google Fonts)」か「OS プリインストール」の
 * どちらかに絞ってある。GitHub の release zip でしか配布されていないもの
 * (PlemolJP, HackGen, Cica 等) は @import で取れないので入れていない。
 */
export const MONO_FONT_OPTIONS: FontOption[] = [
  { value: '', label: 'デフォルト' },
  { value: 'M PLUS 1 Code', label: 'M PLUS 1 Code (日本語)' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' },
  { value: 'MS Gothic', label: 'MS ゴシック (システム)', system: true },
  { value: 'Consolas', label: 'Consolas (システム)', system: true },
  { value: 'Lucida Console', label: 'Lucida Console (システム)', system: true },
  { value: 'Courier New', label: 'Courier New (システム)', system: true },
]

export const FONT_SIZE_BASE = 15
export const FONT_SIZE_MIN = -3
export const FONT_SIZE_MAX = 5

/** 公開範囲ごとのノート背景色 (public はデフォルトのまま) */
export const VISIBILITY_BG_COLORS: Record<
  string,
  { label: string; color: string }
> = {
  home: { label: 'ホーム', color: 'rgba(51, 127, 255, 0.08)' },
  followers: { label: 'フォロワー', color: 'rgba(0, 170, 100, 0.08)' },
  specified: { label: 'ダイレクト', color: 'rgba(255, 90, 120, 0.1)' },
}

export const VISIBILITY_BG_OPTIONS = [
  { value: '', label: 'デフォルト' },
  { value: 'tint', label: '背景色で色分け' },
]

// 数字の非表示 (#593/#594)。yamisskey の hideReactionCount / hide*Count と
// 同じ self/others/all の 3 段階。導線 (クリックで一覧を開く等) は残し数字だけ消す。
// ノート側はリアクション数 + リノート数 (評価シグナル)。返信数は会話の量なので対象外
export const HIDE_COUNT_OPTIONS = [
  { value: '', label: 'デフォルト' },
  { value: 'self', label: '自分のみ隠す' },
  { value: 'others', label: '他人のみ隠す' },
  { value: 'all', label: 'すべて隠す' },
]

export interface CssPresets {
  customFont: string
  monoFont: string
  fontSize: number
  visibilityBg: string
  hideNoteCounts: string
  hideUserStats: string
}

export const EMPTY_PRESETS: CssPresets = {
  customFont: '',
  monoFont: '',
  fontSize: 0,
  visibilityBg: '',
  hideNoteCounts: '',
  hideUserStats: '',
}

function hideCountTargets(key: string): string[] {
  if (key === 'self') return ['true']
  if (key === 'others') return ['false']
  if (key === 'all') return ['true', 'false']
  return []
}

function fontImport(font: string, opt: FontOption | undefined): string {
  const url =
    opt?.importUrl ??
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}&display=swap`
  return `@import url('${url}');`
}

export function parsePresetsFromCss(css: string): CssPresets {
  const fontSize = css.match(/\/\* nd-fontsize: (.+?) \*\//)
  return {
    customFont: css.match(/\/\* nd-font: (.+?) \*\//)?.[1] ?? '',
    monoFont: css.match(/\/\* nd-mono-font: (.+?) \*\//)?.[1] ?? '',
    fontSize: fontSize ? Number(fontSize[1]) : 0,
    visibilityBg: css.match(/\/\* nd-visibility-bg: (.+?) \*\//)?.[1] ?? '',
    hideNoteCounts:
      css.match(/\/\* nd-hide-note-counts: (.+?) \*\//)?.[1] ?? '',
    hideUserStats: css.match(/\/\* nd-hide-user-stats: (.+?) \*\//)?.[1] ?? '',
  }
}

export function buildPresetCss(presets: CssPresets): string {
  // @import は他のルール (@font-face 含む) より前に無いとブラウザに無視される。
  // フォント 2 系統 (本文 / 等幅) を同時に選べるので、生成順ではなく
  // バケツで分けて必ず先頭に寄せる
  const imports: string[] = []
  const parts: string[] = []

  if (presets.customFont) {
    const font = presets.customFont
    const opt = FONT_OPTIONS.find((o) => o.value === font)
    parts.push(`/* nd-font: ${font} */`)
    if (opt?.customCss) {
      parts.push(opt.customCss)
    } else {
      imports.push(fontImport(font, opt))
    }
    parts.push(`html { font-family: '${font}', sans-serif; }`)
  }

  if (presets.monoFont) {
    const font = presets.monoFont
    const opt = MONO_FONT_OPTIONS.find((o) => o.value === font)
    parts.push(`/* nd-mono-font: ${font} */`)
    if (opt?.customCss) {
      parts.push(opt.customCss)
    } else if (!opt?.system) {
      imports.push(fontImport(font, opt))
    }
    // :root で上書きする (global.css の :root と同特異度 + 後勝ち)
    parts.push(`:root { --nd-font-mono: '${font}', monospace; }`)
  }

  if (presets.fontSize !== 0) {
    const px = FONT_SIZE_BASE + presets.fontSize
    parts.push(`/* nd-fontsize: ${presets.fontSize} */`)
    parts.push(`html { font-size: ${px}px; }`)
  }

  if (presets.visibilityBg === 'tint') {
    parts.push('/* nd-visibility-bg: tint */')
    for (const [visibility, { color }] of Object.entries(
      VISIBILITY_BG_COLORS,
    )) {
      parts.push(
        `.note-root[data-visibility="${visibility}"] { background-color: ${color}; }`,
      )
    }
  }

  const noteCountTargets = hideCountTargets(presets.hideNoteCounts)
  if (noteCountTargets.length > 0) {
    parts.push(`/* nd-hide-note-counts: ${presets.hideNoteCounts} */`)
    for (const own of noteCountTargets) {
      parts.push(
        `.note-root[data-own="${own}"] :is(.note-reaction-count, .note-renote-count) { display: none; }`,
      )
    }
  }

  const statsTargets = hideCountTargets(presets.hideUserStats)
  if (statsTargets.length > 0) {
    parts.push(`/* nd-hide-user-stats: ${presets.hideUserStats} */`)
    for (const own of statsTargets) {
      parts.push(
        `.user-stats[data-own="${own}"] .user-stat-count { font-size: 0; }`,
      )
      parts.push(
        `.user-stats[data-own="${own}"] .user-stat-count::before { content: '-'; font-size: 1rem; }`,
      )
    }
  }

  return [...imports, ...parts].join('\n')
}

export function extractUserCss(fullCss: string): string {
  return fullCss
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return false
      if (t.startsWith('/* nd-font:')) return false
      if (t.startsWith('/* nd-mono-font:')) return false
      if (t.startsWith('/* nd-fontsize:')) return false
      if (t.startsWith('/* nd-visibility-bg:')) return false
      if (t.startsWith('/* nd-hide-note-counts:')) return false
      if (t.startsWith('/* nd-hide-user-stats:')) return false
      // 生成行 (1 行完結) のみ除去。ユーザーが複数行で書いた同セレクタは残す
      if (t.match(/^\.note-root\[data-visibility=.+\{.*\}$/)) return false
      if (t.match(/^\.note-root\[data-own=.+\{.*\}$/)) return false
      if (t.match(/^\.user-stats\[data-own=.+\{.*\}$/)) return false
      if (t.startsWith('@import url(')) return false
      if (t.startsWith('@font-face')) return false
      if (t.match(/^html\s*\{\s*font-family:/)) return false
      if (t.match(/^html\s*\{\s*font-size:/)) return false
      if (t.match(/^:root\s*\{\s*--nd-font-mono:/)) return false
      return true
    })
    .join('\n')
    .trim()
}
