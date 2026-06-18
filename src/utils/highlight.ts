import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki'
import { shallowRef } from 'vue'

export const highlighterLoaded = shallowRef(false)

let highlighter: HighlighterCore | null = null
let initPromise: Promise<void> | null = null
let purify: typeof import('dompurify').default | null = null

const langAliases: Record<string, string> = {
  ais: 'aiscript',
  is: 'aiscript',
  json5: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  tsx: 'typescript',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
}

/** Languages loaded lazily on first encounter. */
const lazyLangLoaders: Record<
  string,
  () => Promise<{ default: LanguageRegistration[] }>
> = {
  c: () => import('shiki/dist/langs/c.mjs'),
  cpp: () => import('shiki/dist/langs/cpp.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  kotlin: () => import('shiki/dist/langs/kotlin.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  ruby: () => import('shiki/dist/langs/ruby.mjs'),
}

/** Track which lazy languages are currently being loaded to avoid duplicates. */
const pendingLangs = new Set<string>()

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => htmlEscapeMap[c] ?? c)
}

function colorToClass(color: string): string {
  return `shiki-${color.replace('#', '').toLowerCase()}`
}

function tokensToHtml(tokens: ThemedToken[][], fg?: string): string {
  const fgClass = fg ? ` ${colorToClass(fg)}` : ''

  let html = `<pre class="shiki${fgClass}"><code>`
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0) html += '\n'
    const line = tokens[i]
    if (!line) continue
    for (const token of line) {
      const content = escapeHtml(token.content)
      const classes: string[] = []

      if (token.color) {
        classes.push(colorToClass(token.color))
      }
      if (token.fontStyle) {
        if (token.fontStyle & 1) classes.push('shiki-italic')
        if (token.fontStyle & 2) classes.push('shiki-bold')
        if (token.fontStyle & 4) classes.push('shiki-underline')
      }

      if (classes.length > 0) {
        html += `<span class="${classes.join(' ')}">${content}</span>`
      } else {
        html += content
      }
    }
  }
  html += '</code></pre>'
  return html
}

function initHighlighter(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    const [
      shikiCore,
      shikiEngine,
      themeModule,
      aiscriptGrammar,
      ...langModules
    ] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/dist/themes/dark-plus.mjs'),
      import('@/assets/aiscript.tmLanguage.json'),
      // Core languages — most common in Misskey posts
      import('shiki/dist/langs/bash.mjs'),
      import('shiki/dist/langs/css.mjs'),
      import('shiki/dist/langs/html.mjs'),
      import('shiki/dist/langs/javascript.mjs'),
      import('shiki/dist/langs/json.mjs'),
      import('shiki/dist/langs/markdown.mjs'),
      import('shiki/dist/langs/rust.mjs'),
      import('shiki/dist/langs/sql.mjs'),
      import('shiki/dist/langs/typescript.mjs'),
      import('shiki/dist/langs/yaml.mjs'),
      // healthcheck の診断ログ表示用 (#644)
      import('shiki/dist/langs/log.mjs'),
    ])

    highlighter = shikiCore.createHighlighterCoreSync({
      themes: [themeModule.default],
      langs: [
        ...langModules.map((m) => m.default),
        aiscriptGrammar.default as unknown as LanguageRegistration,
      ],
      engine: shikiEngine.createJavaScriptRegexEngine(),
    })
    const mod = await import('dompurify')
    purify = mod.default
    highlighterLoaded.value = true
  })()

  return initPromise
}

/** Load a lazy language on demand and register it with the highlighter. */
async function loadLazyLang(lang: string): Promise<void> {
  const loader = lazyLangLoaders[lang]
  if (!loader || !highlighter || pendingLangs.has(lang)) return
  pendingLangs.add(lang)
  try {
    const mod = await loader()
    highlighter.loadLanguageSync(mod.default)
  } finally {
    pendingLangs.delete(lang)
  }
}

export function highlightCode(code: string, lang: string | null): string {
  const resolved = lang ? (langAliases[lang] ?? lang) : null
  if (
    !resolved ||
    !highlighter?.getLoadedLanguages().includes(resolved) ||
    !purify
  ) {
    if (lang && !initPromise) initHighlighter()
    // Trigger lazy load if the language is available but not yet loaded
    if (resolved && highlighter && purify && lazyLangLoaders[resolved]) {
      loadLazyLang(resolved)
    }
    return `<pre><code>${escapeHtml(code)}</code></pre>`
  }
  const { tokens, fg } = highlighter.codeToTokens(code, {
    lang: resolved,
    theme: 'dark-plus',
  })
  return purify.sanitize(tokensToHtml(tokens, fg), {
    ALLOWED_TAGS: ['pre', 'code', 'span'],
    ALLOWED_ATTR: ['class'],
  })
}
