#!/usr/bin/env node
// dist のビルド出力が起動クリティカルパスの予算内かを機械的に検査する (#985)。
//
// rolldown-vite の manualChunks は名前付きグループを共有モジュールの受け皿に
// してしまい、Vue ランタイムごと entry の静的閉包に吸収されて 3.9MB の
// render-blocking チャンクを作っていた。しかも config 上は vendor-vue 等の
// ルールが「書いてあるのに出力に存在しない」壊れ方で、誰も気づけなかった。
// チャンク構成の腐りは無症状なので、設定ではなく出力を検査して止める。
//
// 予算は「現状の実測値 + 余裕」。超えたらチャンク設定か import グラフの退行。
// 引き上げる場合は、何が増えたのかを dist で特定してから。

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

// 実測 (2026-08): render-blocking CSS 26KB / entry 静的閉包 970KB
const BUDGET_RENDER_BLOCKING_CSS = 120_000
const BUDGET_ENTRY_STATIC_JS = 1_500_000

let html
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8')
} catch {
  console.error('check-dist-budget: dist/index.html がない。先に pnpm build を実行する')
  process.exit(1)
}

const problems = []

// render-blocking CSS: index.html の <link rel="stylesheet"> 合計
const cssFiles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"/g)].map(
  (m) => m[1],
)
const cssTotal = cssFiles.reduce((sum, f) => sum + statSync(join(DIST, f)).size, 0)
if (cssTotal > BUDGET_RENDER_BLOCKING_CSS) {
  problems.push(
    `render-blocking CSS 合計 ${cssTotal.toLocaleString()}B > 予算 ${BUDGET_RENDER_BLOCKING_CSS.toLocaleString()}B\n` +
      cssFiles.map((f) => `    ${f}: ${statSync(join(DIST, f)).size.toLocaleString()}B`).join('\n'),
  )
}

// entry 静的閉包: entry から静的 import (import "..." / from "...") で到達する
// JS の合計。動的 import( は遅延ロードなので対象外
const entry = html.match(/<script[^>]*src="\/(assets\/[^"]+\.js)"/)?.[1]
if (!entry) {
  console.error('check-dist-budget: dist/index.html に entry script が見つからない')
  process.exit(1)
}
const seen = new Set()
function walk(file) {
  if (seen.has(file)) return
  seen.add(file)
  const code = readFileSync(join(DIST, file), 'utf8')
  for (const m of code.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) {
    walk(`assets/${m[1]}`)
  }
}
walk(entry)
const jsTotal = [...seen].reduce((sum, f) => sum + statSync(join(DIST, f)).size, 0)
if (jsTotal > BUDGET_ENTRY_STATIC_JS) {
  const top = [...seen]
    .map((f) => [f, statSync(join(DIST, f)).size])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  problems.push(
    `entry 静的閉包 ${jsTotal.toLocaleString()}B (${seen.size} ファイル) > 予算 ${BUDGET_ENTRY_STATIC_JS.toLocaleString()}B\n` +
      top.map(([f, s]) => `    ${f}: ${s.toLocaleString()}B`).join('\n'),
  )
}

if (problems.length > 0) {
  console.error('check-dist-budget: 起動クリティカルパスの予算超過\n')
  for (const p of problems) console.error(`  ${p}\n`)
  process.exit(1)
}

console.log(
  `check-dist-budget: OK (render-blocking CSS ${cssTotal.toLocaleString()}B, entry 静的閉包 ${jsTotal.toLocaleString()}B / ${seen.size} ファイル)`,
)
