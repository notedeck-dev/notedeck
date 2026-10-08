import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki'
import { shallowRef } from 'vue'
import { ND_CODE_THEME_NAME, ndCodeTheme } from './highlightTheme'

export const highlighterLoaded = shallowRef(false)

/**
 * ハイライタの状態が進むたびに増える版数。初期化完了だけでなく**遅延ロードの
 * 言語が入ったとき**も進む。`highlighterLoaded` (boolean) だけを再描画キーに
 * 使うと、遅延言語 (python / diff 等) は「ロードが終わっても誰も再描画しない」
 * ためハイライトされないままになる。描画側はこれをキーに含めること。
 *
 * コード面の明暗 (#1053) はここでは扱わない。トークン色は CSS 変数
 * (`--nd-code-token-*`、highlightTheme) 経由なので、切替は CSS 側だけで済み
 * 再描画しない (#1050)。
 */
export const highlightRevision = shallowRef(0)

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
  // AI が編集内容を ```diff で見せることがある (#981)
  diff: () => import('shiki/dist/langs/diff.mjs'),
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

function tokensToHtml(tokens: ThemedToken[][], fg: string | undefined): string {
  return `<pre class="shiki"><code>${tokensToInnerHtml(tokens, fg)}</code></pre>`
}

/**
 * トークン列を span 列だけの HTML にする (pre / code は呼び出し側の持ち物)。
 * 色はテーマが `var(--nd-code-token-*)` を返すので、そのまま inline style に
 * 乗せる。既定の前景色と同じトークンは pre 側の色 (`pre.shiki`) に任せて素で出す
 */
function tokensToInnerHtml(
  tokens: ThemedToken[][],
  fg: string | undefined,
): string {
  let html = ''
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0) html += '\n'
    const line = tokens[i]
    if (!line) continue
    for (const token of line) {
      const content = escapeHtml(token.content)
      const styles: string[] = []

      if (token.color && token.color !== fg) {
        styles.push(`color:${token.color}`)
      }
      if (token.fontStyle) {
        if (token.fontStyle & 1) styles.push('font-style:italic')
        if (token.fontStyle & 2) styles.push('font-weight:bold')
        if (token.fontStyle & 4) styles.push('text-decoration:underline')
      }

      if (styles.length > 0) {
        html += `<span style="${styles.join(';')}">${content}</span>`
      } else {
        html += content
      }
    }
  }
  return html
}

function initHighlighter(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    const [shikiCore, shikiEngine, aiscriptGrammar, ...langModules] =
      await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
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
      themes: [ndCodeTheme],
      langs: [
        ...langModules.map((m) => m.default),
        aiscriptGrammar.default as unknown as LanguageRegistration,
      ],
      engine: shikiEngine.createJavaScriptRegexEngine(),
    })
    const mod = await import('dompurify')
    purify = mod.default
    highlighterLoaded.value = true
    highlightRevision.value++
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
    highlightRevision.value++
  } finally {
    pendingLangs.delete(lang)
  }
}

/**
 * ハイライト可能なら解決済み言語名を返す。不可なら null を返し、必要な
 * 初期化 / 遅延ロードを走らせる (完了後は highlighterLoaded で再描画される)。
 */
function resolveReadyLang(lang: string | null): string | null {
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
    return null
  }
  return resolved
}

export function highlightCode(code: string, lang: string | null): string {
  const resolved = resolveReadyLang(lang)
  if (!resolved || !highlighter || !purify) {
    return `<pre><code>${escapeHtml(code)}</code></pre>`
  }
  const { tokens, fg } = highlighter.codeToTokens(code, {
    lang: resolved,
    theme: ND_CODE_THEME_NAME,
  })
  return purify.sanitize(tokensToHtml(tokens, fg), {
    ALLOWED_TAGS: ['pre', 'code', 'span'],
    ALLOWED_ATTR: ['class', 'style'],
  })
}

/**
 * ハイライト済みのトークン HTML だけを返す (pre / code は呼び出し側が持つ)。
 * 独自の pre 構造を持つ描画 (AI メッセージの markdown — コピーボタン同居) から
 * 使う。ハイライトできないときは null (= 呼び出し側が素のエスケープで出す)。
 */
export function highlightCodeTokens(
  code: string,
  lang: string | null,
): string | null {
  const resolved = resolveReadyLang(lang)
  if (!resolved || !highlighter || !purify) return null
  const { tokens, fg } = highlighter.codeToTokens(code, {
    lang: resolved,
    theme: ND_CODE_THEME_NAME,
  })
  return purify.sanitize(tokensToInnerHtml(tokens, fg), {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['style'],
  })
}
