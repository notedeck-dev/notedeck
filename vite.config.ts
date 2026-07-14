import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import JSON5 from 'json5'
import type {
  ChildNode,
  Container,
  Document,
  AtRule as PostcssAtRule,
  Plugin as PostcssPlugin,
  Rule,
} from 'postcss'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const appVersion = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'),
).version

function json5Plugin(): Plugin {
  return {
    name: 'json5',
    transform(code, id) {
      if (!id.endsWith('.json5')) return undefined
      const parsed = JSON5.parse(code)
      return { code: `export default ${JSON.stringify(parsed)}`, map: null }
    },
  }
}

/**
 * :hover ルールを @media (hover: hover) で包み、タッチ環境の sticky hover
 * (タップ後にホバー背景が貼り付く Android WebView の定番問題) を全 CSS で防ぐ (#704 F)。
 * ソース側 350+ 箇所を個別に括る代わりにビルド時に一括変換する。
 */
function hoverMediaGuard(): PostcssPlugin {
  const isHoverMedia = (node: Container<ChildNode> | Document | undefined) => {
    for (let p = node; p; p = p.parent as Container<ChildNode> | undefined) {
      if (p.type === 'atrule') {
        const at = p as unknown as PostcssAtRule
        if (at.name === 'media' && at.params.includes('hover')) return true
      }
    }
    return false
  }
  return {
    postcssPlugin: 'nd-hover-media-guard',
    Rule(rule: Rule, { AtRule }) {
      if (!rule.selector.includes(':hover')) return
      // 既に hover 系メディアクエリ内なら二重に包まない (再訪問の停止条件でもある)
      if (isHoverMedia(rule.parent)) return
      const hoverSelectors = rule.selectors.filter((s) => s.includes(':hover'))
      const plainSelectors = rule.selectors.filter((s) => !s.includes(':hover'))
      const media = new AtRule({ name: 'media', params: '(hover: hover)' })
      if (plainSelectors.length === 0) {
        rule.replaceWith(media)
        media.append(rule)
      } else {
        // セレクタリスト混在時は :hover 側だけを分離して包む
        const hoverRule = rule.clone()
        hoverRule.selectors = hoverSelectors
        rule.selectors = plainSelectors
        rule.after(media)
        media.append(hoverRule)
      }
    },
  }
}

function stripUnusedFonts(): Plugin {
  return {
    name: 'strip-unused-fonts',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type === 'asset' &&
          typeof chunk.source === 'string' &&
          chunk.fileName.endsWith('.css')
        ) {
          chunk.source = chunk.source
            .replace(/,\s*url\([^)]*\.woff\b[^)]*\)\s*format\("woff"\)/g, '')
            .replace(/,\s*url\([^)]*\.ttf[^)]*\)\s*format\("truetype"\)/g, '')
        }
      }
      for (const name of Object.keys(bundle)) {
        if (/\.(woff|ttf)$/.test(name)) {
          delete bundle[name]
        }
      }
    },
  }
}

function subsetTablerIcons(): Plugin {
  const usedIcons = new Set<string>()

  function collectIcons(code: string) {
    // Static: class="ti ti-home", 'ti ti-search'
    for (const m of code.matchAll(/ti[\s-]ti-([a-z][a-z0-9-]*)/g)) {
      usedIcons.add(m[1])
    }
    // Standalone 'ti-xxx' strings (e.g. icon: 'ti-planet')
    for (const m of code.matchAll(/['"]ti-([a-z][a-z0-9-]*)['"]/g)) {
      usedIcons.add(m[1])
    }
    // Record values: key: 'icon-name' (e.g. local: 'planet', icon: 'search')
    for (const m of code.matchAll(/\b\w+\s*:\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
      // Only add if the value is a valid tabler icon name (checked later against CSS)
      usedIcons.add(m[1])
    }
  }

  return {
    name: 'subset-tabler-icons',
    enforce: 'pre',

    transform(code, id) {
      if (/\.(vue|ts|tsx)$/.test(id) && !id.includes('node_modules')) {
        collectIcons(code)
      }
      return undefined
    },

    async generateBundle(_, bundle) {
      if (usedIcons.size === 0) return

      // Read the full (non-minified) tabler-icons CSS to parse codepoints
      const fullCssPath = resolve(
        import.meta.dirname,
        'node_modules/@tabler/icons-webfont/dist/tabler-icons.css',
      )
      const fullCss = readFileSync(fullCssPath, 'utf-8')

      // Build codepoint map: icon-name -> unicode char
      const codepointMap = new Map<string, string>()
      for (const m of fullCss.matchAll(
        /\.ti-([a-z][a-z0-9-]*)(?::before)?\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g,
      )) {
        codepointMap.set(m[1], String.fromCodePoint(Number.parseInt(m[2], 16)))
      }

      // Collect unicode chars for used icons
      const usedChars = [...usedIcons]
        .map((name) => codepointMap.get(name))
        .filter((c): c is string => c != null)
        .join('')

      // 1. Filter CSS: keep only @font-face + .ti base + used .ti-xxx rules
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type !== 'asset' ||
          typeof chunk.source !== 'string' ||
          !chunk.fileName.endsWith('.css')
        )
          continue
        if (!chunk.source.includes('.ti-')) continue

        // Replace each .ti-xxx{...} block: keep only if icon is used
        chunk.source = chunk.source.replace(
          /\.ti-([a-z][a-z0-9-]*)(?::before)?\s*\{[^}]*\}/g,
          (match, name: string) => (usedIcons.has(name) ? match : ''),
        )
      }

      // 2. Subset the woff2 font
      const subsetFont = (await import('subset-font')).default
      for (const [name, chunk] of Object.entries(bundle)) {
        if (
          chunk.type !== 'asset' ||
          !name.includes('tabler-icons') ||
          !name.endsWith('.woff2')
        )
          continue
        if (!(chunk.source instanceof Uint8Array)) continue

        chunk.source = new Uint8Array(
          await subsetFont(Buffer.from(chunk.source), usedChars, {
            targetFormat: 'woff2',
          }),
        )
      }
    },
  }
}

/** Inject <link rel="preload"> for the subset tabler-icons woff2 font.
 *  The hash changes each build due to subsetting, so we find the actual
 *  asset name from the bundle and inject the tag at build time. */
function preloadTablerFont(): Plugin {
  return {
    name: 'preload-tabler-font',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const fontAsset = Object.keys(ctx.bundle).find(
          (name) => name.includes('tabler-icons') && name.endsWith('.woff2'),
        )
        if (!fontAsset) return html
        const tag = `<link rel="preload" href="/${fontAsset}" as="font" type="font/woff2" crossorigin>`
        return html.replace(
          '<link rel="stylesheet"',
          `${tag}\n    <link rel="stylesheet"`,
        )
      },
    },
  }
}

function injectAppVersion(): Plugin {
  return {
    name: 'inject-app-version',
    transformIndexHtml(html) {
      return html.replaceAll('__ND_APP_VERSION__', appVersion)
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    json5Plugin(),
    stripUnusedFonts(),
    subsetTablerIcons(),
    preloadTablerFont(),
    injectAppVersion(),
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  css: {
    // 変換ステージは postcss (hoverMediaGuard のため)。
    // 従来の lightningcss transformer は targets 未指定でコンパイルダウンなし
    // だったので、失う変換は無い。minify は引き続き build.cssMinify の
    // lightningcss が担う
    postcss: {
      plugins: [hoverMediaGuard()],
    },
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  build: {
    cssMinify: 'lightningcss',
    target: 'esnext',
    sourcemap: false,
    modulePreload: false,
    assetsInlineLimit: 8192,
    reportCompressedSize: false,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/vue/') ||
            id.includes('node_modules/vue-router/') ||
            id.includes('node_modules/pinia/')
          ) {
            return 'vendor-vue'
          }
          if (id.includes('node_modules/@syuilo/aiscript')) {
            return 'vendor-aiscript'
          }
          if (
            id.includes('node_modules/@codemirror/') ||
            id.includes('node_modules/@lezer/')
          ) {
            return 'vendor-codemirror'
          }
          if (id.includes('node_modules/@scalar/')) {
            return 'vendor-api-docs'
          }
          // Bundle rarely-used column types into a single shared chunk
          if (
            id.includes('src/components/deck/Deck') &&
            /(?:AboutMisskey|Ads|Achievements|ApiConsole|ApiDocs|ServerInfo|Emoji|Gallery|Explore|FollowRequests|Lookup|Announcements|Play|AiScript)Column\.vue/.test(
              id,
            )
          ) {
            return 'columns-rare'
          }
        },
        minify: {
          compress: {
            dropConsole: true,
          },
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(
      (() => {
        try {
          return execSync('git rev-parse HEAD').toString().trim()
        } catch {
          return 'unknown'
        }
      })(),
    ),
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  clearScreen: false,
  optimizeDeps: {
    // ルートindex.htmlのみスキャン（src-tauri/target/doc/*.htmlを除外）
    entries: ['index.html'],
    // 頻出の依存を事前バンドルして初回dev起動を高速化
    include: [
      'vue',
      'vue-router',
      'pinia',
      '@vueuse/core',
      '@tauri-apps/api',
      'dompurify',
    ],
  },
  server: {
    strictPort: true,
    warmup: {
      clientFiles: [
        'src/App.vue',
        'src/views/DeckPage.vue',
        'src/components/deck/DeckLayout.vue',
        'src/components/deck/DeckColumnsArea.vue',
        'src/stores/deck.ts',
        'src/stores/accounts.ts',
      ],
    },
    watch: {
      // WSL2: ポーリングを無効にしてイベントベース監視を強制（CPU負荷軽減）
      usePolling: false,
      ignored: ['**/src-tauri/target/**'],
    },
  },
})
