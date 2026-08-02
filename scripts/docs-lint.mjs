#!/usr/bin/env node
// リポジトリ直下の .md が実装とずれて腐るのを機械的に止める (#895)。
//
// CLAUDE.md には #883 として「書いた瞬間に古くなる数値を書かず正本を指せ」という
// ルールがあるが、ARCHITECTURE.md 自身がそれを破っていた。真因はルールの不在では
// なく、ルールが人間の注意力にしか依存していなかったこと。ここで機械に移す。
//
// どうしても数値を書く必要がある箇所は、直前の行に
//   <!-- docs-lint-disable-next-line 理由 -->
// を置く。理由は必須 (何も書けないなら、それは書くべきでない数値)。

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import GithubSlugger from 'github-slugger'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 実装から数えられる実体。これらの近くにある数値は、書いた瞬間から腐る。
// 「3 層モデル」「2 種類のプロトコル」のような設計上の固定値とは区別する
const COUNTABLE = [
  'ストア',
  'Pinia',
  'composable',
  'コンポーザブル',
  'capability',
  'builtin',
  'コマンド',
  'カラム種別',
  'ウィンドウ種別',
  'スキル',
  'プロパティ',
  '責務',
]

const DISABLE = /<!--\s*docs-lint-disable-next-line\s+\S/

/**
 * コードブロックと inline code を空白に潰す (中の行番号やリンクは検査対象外)。
 * ただし mermaid は「図として読まれる本文」なので、中の数値は本文と同じく腐る。
 * 実際 ARCHITECTURE.md の図はストア数を古いまま抱えていた
 */
function stripCode(text) {
  return text
    .replace(/```(\w*)\n[\s\S]*?```/g, (m, lang) =>
      lang === 'mermaid' ? m : m.replace(/[^\n]/g, ' '),
    )
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

function checkLineRefs(line) {
  const problems = []
  // L342 / L53–70 / L53-70 — 行番号は 1 コミットでずれる。
  // 2 桁以上に限るのは、ROADMAP の開放レベル (L0〜L4) と衝突するため
  const lRef = line.match(/\bL\d{2,}(?:\s*[–—-]\s*\d+)?\b/g)
  if (lRef) problems.push(`行番号参照 ${lRef.join(', ')}`)
  // src/foo.ts:123 形式
  const pathRef = line.match(/[\w./-]+\.(?:ts|vue|rs|mjs|js|json5?):\d+/g)
  if (pathRef) problems.push(`行番号付きパス ${pathRef.join(', ')}`)
  return problems
}

function checkCounts(line) {
  const problems = []
  // 「以上」「超」で下限を示すのは CLAUDE.md が明示的に許可している書き方。
  // 「80+個」のような表記は下限のつもりでも実数と乖離した時に嘘に見えるので、
  // 日本語で「以上」と書くか正本を指すかのどちらかに寄せる
  const numbers = [...line.matchAll(/(\d+)\+?\s*(?:個|本|種類|件|ファイル|回)(?!以上|超)/g)]
  if (numbers.length === 0) return problems
  const lower = line.toLowerCase()
  for (const term of COUNTABLE) {
    const idx = lower.indexOf(term.toLowerCase())
    if (idx === -1) continue
    for (const n of numbers) {
      // 同じ文の中で実体と数値が隣接しているか (前後 30 文字)
      if (Math.abs(n.index - idx) <= 30) {
        problems.push(`実体数の直書き "${n[0]}" (${term})`)
        break
      }
    }
  }
  return problems
}

function collectAnchors(text) {
  const anchors = new Set()
  // GitHub 自身が使う実装をそのまま使う。どの記号が落ちるか (全角括弧も
  // 中黒も落ちる) を手で再現しようとすると必ずずれる。同じ見出しの 2 回目に
  // -1, -2 と連番を振るのもこの中でやってくれる
  const slugger = new GithubSlugger()
  for (const line of text.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (!m) continue
    // markdown 記法はレンダリング後のテキストに残らない
    const plain = m[2]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*]/g, '')
      .trim()
    anchors.add(slugger.slug(plain))
  }
  return anchors
}

function checkLinks(file, text, anchorsByFile) {
  const problems = []
  // [表示](./path.md#anchor) と [表示](#anchor)。http(s) と mailto は対象外
  for (const m of text.matchAll(/\[[^\]]*\]\((?!https?:|mailto:)([^)\s]+)\)/g)) {
    const [target, anchor] = m[1].split('#')
    const line = () => text.slice(0, m.index).split('\n').length

    if (target) {
      const abs = resolve(dirname(join(ROOT, file)), target)
      if (!existsSync(abs)) {
        problems.push({ line: line(), message: `リンク先が存在しない: ${target}` })
        continue
      }
    }
    if (!anchor) continue

    // 同一ディレクトリの .md だけ照合できる (画像や外部ファイルは対象外)
    const key = target ? target.replace(/^\.\//, '') : file
    const anchors = anchorsByFile.get(key)
    if (anchors && !anchors.has(decodeURIComponent(anchor))) {
      problems.push({
        line: line(),
        message: `見出しが存在しない: ${target || file}#${anchor}`,
      })
    }
  }
  return problems
}

const files = readdirSync(ROOT).filter((f) => f.endsWith('.md'))
let failed = 0

// リンク先の見出しを照合するので、先に全ファイルの id を集めておく
const sources = new Map(
  files.map((f) => [f, stripCode(readFileSync(join(ROOT, f), 'utf8'))]),
)
const anchorsByFile = new Map(
  [...sources].map(([f, text]) => [f, collectAnchors(text)]),
)

for (const file of files) {
  const raw = readFileSync(join(ROOT, file), 'utf8')
  const stripped = sources.get(file)
  const lines = stripped.split('\n')
  const rawLines = raw.split('\n')

  const found = []

  lines.forEach((line, i) => {
    if (i > 0 && DISABLE.test(rawLines[i - 1])) return
    for (const message of [...checkLineRefs(line), ...checkCounts(line)]) {
      found.push({ line: i + 1, message })
    }
  })
  found.push(...checkLinks(file, stripped, anchorsByFile))

  for (const p of found.sort((a, b) => a.line - b.line)) {
    console.error(`${file}:${p.line}  ${p.message}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\n${failed} 件。数値と行番号は正本のファイルを指す形に書き換えてください (#883 / #895)。`)
  console.error('どうしても必要なら直前の行に <!-- docs-lint-disable-next-line 理由 --> を置きます。')
  process.exit(1)
}

console.log(`docs-lint: ${files.length} ファイル、問題なし`)
