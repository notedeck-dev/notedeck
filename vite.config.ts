import { execSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs'
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
import type { Plugin, ProxyOptions } from 'vite'
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

/**
 * Unicode 絵文字の Twemoji SVG を同梱して `/twemoji/` で配る (#855)。
 * CDN (jsdelivr) から 1 絵文字 1 リクエストで取る方式は、ピッカー初回表示で
 * 数千リクエストがメディアプロキシに殺到する要因だった。アセットは Misskey
 * 本家と同系の Discord fork (@discordapp/twemoji)。
 */
function twemojiAssets(): Plugin {
  const src = resolve(
    import.meta.dirname,
    'node_modules/@discordapp/twemoji/dist/svg',
  )
  let outDir = 'dist'
  return {
    name: 'nd-twemoji-assets',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use('/twemoji', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? ''
        // コードポイント列のファイル名のみ許可 (パストラバーサル防止)
        if (!/^[0-9a-f-]+\.svg$/.test(name)) return next()
        try {
          const data = readFileSync(resolve(src, name))
          res.setHeader('Content-Type', 'image/svg+xml')
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end(data)
        } catch {
          res.statusCode = 404
          res.end()
        }
      })
    },
    writeBundle() {
      cpSync(src, resolve(import.meta.dirname, outDir, 'twemoji'), {
        recursive: true,
      })
    },
  }
}

// --- 内蔵 HTTP サーバー (127.0.0.1:19820, #940) への dev 橋渡し (#977) ---
// ブラウザ (5173) のダッシュボード面から external API を叩けるよう、無認証の
// /api インデックスが開示する tokenPath を Node 側で読み、Bearer を注入する。
// トークンはアプリ起動ごとに再生成される ephemeral なので毎リクエスト読む
// (Vite 常駐中のアプリ再起動に追従するため)。

const ND_APP_ORIGIN = 'http://127.0.0.1:19820'
let ndTokenPath: string | null = null
let ndLogDir: string | null = null
let ndTokenPathResolving: Promise<void> | null = null

function resolveNdTokenPath(): Promise<void> {
  ndTokenPathResolving ??= fetch(`${ND_APP_ORIGIN}/api`)
    .then(async (r) => {
      const index = (await r.json()) as { tokenPath?: string; logDir?: string }
      ndTokenPath = index.tokenPath ?? null
      ndLogDir = index.logDir ?? null
    })
    .catch(() => {
      // アプリ未起動 — 次のリクエストで再解決する
    })
    .finally(() => {
      ndTokenPathResolving = null
    })
  return ndTokenPathResolving
}

/** proxy より先に走る middleware で tokenPath 解決を待ち、初回リクエストの注入漏れを防ぐ */
function ndApiBridge(): Plugin {
  return {
    name: 'nd-api-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', async (_req, _res, next) => {
        if (!ndTokenPath) await resolveNdTokenPath()
        next()
      })

      // Rust ログ tail (#977)。アプリの tracing 日次ローテートログ
      // (notedeck.log.YYYY-MM-DD) を SSE で流す。ログの所在は /api インデックス
      // の logDir から解決する。dev server 自身の面なので認証は挟まない
      server.middlewares.use('/dev/logs', async (req, res) => {
        if (!ndLogDir) await resolveNdTokenPath()
        const logDir = ndLogDir
        if (!logDir) {
          res.statusCode = 503
          res.end('log dir unknown (app not running?)')
          return
        }
        // 日付サフィックスは辞書順 = 時系列順なので末尾が最新
        const pickLatest = (): string | null => {
          try {
            const files = readdirSync(logDir)
              .filter((f) => f.startsWith('notedeck.log'))
              .sort()
            const last = files[files.length - 1]
            return last ? resolve(logDir, last) : null
          } catch {
            return null
          }
        }
        let file = pickLatest()
        if (!file) {
          res.statusCode = 404
          res.end('no log file yet')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        let offset = 0
        const sendNew = () => {
          try {
            const latest = pickLatest()
            if (latest && latest !== file) {
              // 日次ローテート追従
              file = latest
              offset = 0
            }
            if (!file) return
            const size = statSync(file).size
            if (size < offset) offset = 0 // truncate 対応
            if (size === offset) return
            const fd = openSync(file, 'r')
            const buf = Buffer.alloc(size - offset)
            readSync(fd, buf, 0, buf.length, offset)
            closeSync(fd)
            offset = size
            for (const line of buf.toString('utf-8').split('\n')) {
              if (line) res.write(`data: ${line}\n\n`)
            }
          } catch {
            // ファイル消失等 — 次周期の pickLatest で回復する
          }
        }
        // 初期表示は末尾 32KB のみ (先頭行は途中からの可能性あり)
        try {
          offset = Math.max(0, statSync(file).size - 32 * 1024)
        } catch {
          offset = 0
        }
        sendNew()
        const timer = setInterval(sendNew, 1000)
        req.on('close', () => clearInterval(timer))
      })
    },
  }
}

function ndApiProxy(): Record<string, ProxyOptions> {
  return {
    '/api': {
      target: ND_APP_ORIGIN,
      changeOrigin: true,
      configure(proxy) {
        proxy.on('proxyReq', (proxyReq) => {
          if (!ndTokenPath) return
          if (proxyReq.getHeader('authorization')) return
          try {
            const token = readFileSync(ndTokenPath, 'utf-8').trim()
            proxyReq.setHeader('Authorization', `Bearer ${token}`)
          } catch {
            // トークンファイル不在 (アプリ起動直後など) は無認証で通す
          }
        })
      },
    },
    // 画像プロキシは無認証なので素通し
    '/proxy': { target: ND_APP_ORIGIN, changeOrigin: true },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    json5Plugin(),
    stripUnusedFonts(),
    subsetTablerIcons(),
    preloadTablerFont(),
    twemojiAssets(),
    ndApiBridge(),
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
        // manualChunks は書かない (#985)。rolldown-vite の manualChunks は
        // 名前付きグループを共有モジュールの受け皿にしてしまい、Vue ランタイム
        // ごと entry の静的閉包へ吸収されて render-blocking な巨大チャンクを
        // 作っていた（グループが 1 つでも残ると吸収先が移るだけ）。素の
        // per-component 分割で entry 静的閉包 4.2MB→0.97MB を実測確認済み。
        // Tauri 同梱配布では vendor 分割の HTTP キャッシュ利得も無い。
        // 逸脱を検知する検査は scripts/check-dist-budget.mjs
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
    proxy: ndApiProxy(),
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
