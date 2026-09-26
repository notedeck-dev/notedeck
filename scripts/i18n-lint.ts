#!/usr/bin/env node
// 日本語の直書きを増やさない (#135)。
//
//   pnpm lint:i18n                  merge-base (origin/develop) と作業ツリーを比べる
//   node scripts/i18n-lint.ts --base <sha> [--head <rev>]
//   node scripts/i18n-lint.ts --pre-push
//
// UI 文言は辞書 (locales/) に置く。移行は段階的に進むので、既存の直書きは
// 残したまま「変更したファイルの合計で増えていない」ことだけを検査する
// (ラチェット)。数えるのはコメント以外の行で、日本語を含むもの。
//
// 比較の基準:
// - CI の push は push 前の SHA、PR は base の SHA
// - ローカルは pre-push フック。develop へは PR ではなくローカルで merge して
//   push するので、pre-commit や merge-base との比較では検査されない
//
// 数えないもの:
// - 行単位: `i18n-ignore: <理由>` を同じ行に書いた行。理由は IGNORE_REASONS から
//   選ぶ。免除した行の数も増えてはいけない (乱用の歯止め)
// - ファイル単位: EXEMPT_FILES (理由つき。ここへの追加は差分でレビューされる)
//
// 併せて、locale の直書き (`'ja-JP'` を Intl に渡す / 引数なしの toLocale*()) も
// 増やさない。書式は表示言語 (i18n.lang) に従わせる。
//
// 移行が済んだディレクトリ (MIGRATED_DIRS) は、直書きゼロを必須にする。

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const IGNORE_REASONS = ['data', 'prompt', 'mfm-spec', 'test'] as const
const IGNORE = /i18n-ignore:\s*(\S+)/

/** ファイル単位の免除: パス (ROOT 相対) → 理由 */
const EXEMPT_FILES: Record<string, string> = {
  'src/utils/nyaize.ts': 'mfm-spec: 本家の にゃ化 の変換表',
  'src/utils/selfXssWarning.ts':
    'data: 辞書のロード前に出る警告で、dist 予算の検査も文言を見ている',
}

/** 移行が済んだディレクトリ (ROOT 相対の前方一致)。直書きゼロ必須 */
const MIGRATED_DIRS = ['src/i18n/']

const TARGETS: { dir: string; exts: string[] }[] = [
  { dir: 'src', exts: ['.ts', '.vue'] },
  { dir: 'src-tauri/src', exts: ['.rs'] },
  { dir: 'crates', exts: ['.rs'] },
  { dir: 'src-tauri/android', exts: ['.kt'] },
]

const JAPANESE = /[　-ヿ㐀-鿿ｦ-ﾟ]/
const HARD_LOCALE =
  /\b(?:Intl\.\w+|toLocale\w*)\(\s*['"]ja(?:-JP)?['"]|\.toLocale(?:Date|Time)?String\(\s*\)/

export function isTarget(path: string): boolean {
  if (/\.(test|dom\.test)\.ts$/.test(path)) return false
  if (/(^|\/)(generated\.rs|[^/]*\.generated\.(ts|rs))$/.test(path)) return false
  if (/\/tests?\//.test(path) || path.endsWith('/tests.rs')) return false
  if (path in EXEMPT_FILES) return false
  return TARGETS.some(
    (t) => path.startsWith(`${t.dir}/`) && t.exts.some((e) => path.endsWith(e)),
  )
}

export interface Counts {
  japanese: number
  ignored: number
  hardLocale: number
  /** IGNORE_REASONS に無い理由 */
  badReasons: string[]
}

/** コメント (と Vue の style) を空白に潰す。行番号を保つため改行は残す */
function stripComments(path: string, text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  let out = text
  if (path.endsWith('.vue'))
    out = out.replace(/<style[\s\S]*?<\/style>/g, blank).replace(/<!--[\s\S]*?-->/g, blank)
  // Rust の #[cfg(test)] 以降はテスト
  if (path.endsWith('.rs')) {
    const at = out.search(/^\s*#\[cfg\(test\)\]/m)
    if (at !== -1) out = out.slice(0, at)
  }
  out = out.replace(/\/\*[\s\S]*?\*\//g, blank)
  // `//` の行コメント。URL (`https://`) は残す
  return out.replace(/(^|[^:\\])\/\/.*$/gm, (_, head: string) => head)
}

export function count(path: string, text: string): Counts {
  const raw = text.split('\n')
  const code = stripComments(path, text).split('\n')
  const counts: Counts = { japanese: 0, ignored: 0, hardLocale: 0, badReasons: [] }
  code.forEach((line, i) => {
    if (HARD_LOCALE.test(line)) counts.hardLocale++
    if (!JAPANESE.test(line)) return
    const reason = raw[i]?.match(IGNORE)?.[1]
    if (reason === undefined) {
      counts.japanese++
      return
    }
    counts.ignored++
    if (!(IGNORE_REASONS as readonly string[]).includes(reason))
      counts.badReasons.push(`${path}:${i + 1} (${reason})`)
  })
  return counts
}

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()

function readAt(rev: string | null, path: string): string | null {
  if (rev === null) {
    const abs = join(ROOT, path)
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null
  }
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

function resolveRevs(argv: string[]): { base: string; head: string | null } {
  const arg = (name: string) => {
    const i = argv.indexOf(name)
    return i === -1 ? undefined : argv[i + 1]
  }
  let base = arg('--base')
  const head = arg('--head') ?? (argv.includes('--pre-push') ? 'HEAD' : null)
  // push で新しいブランチを作ったときの before は 0 埋め
  if (base !== undefined && /^0+$/.test(base)) base = undefined
  if (base === undefined && argv.includes('--pre-push')) {
    try {
      base = git('rev-parse', '@{push}')
    } catch {
      // push 先がまだ無いブランチ
    }
  }
  if (base === undefined) base = git('merge-base', 'HEAD', 'origin/develop')
  return { base, head }
}

function changedFiles(base: string, head: string | null): string[] {
  const range = head === null ? [base] : [base, head]
  const tracked = git('diff', '--name-only', ...range).split('\n')
  const untracked =
    head === null ? git('ls-files', '--others', '--exclude-standard').split('\n') : []
  return [...new Set([...tracked, ...untracked])].filter(Boolean)
}

function listFiles(dir: string): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(join(dir, e.name))
      : [relative(ROOT, join(abs, e.name))],
  )
}

function main(argv: string[]): number {
  const { base, head } = resolveRevs(argv)
  const problems: string[] = []
  const delta = { japanese: 0, ignored: 0, hardLocale: 0 }
  const grew: string[] = []

  for (const path of changedFiles(base, head).filter(isTarget)) {
    const before = readAt(base, path)
    const after = readAt(head, path)
    const b = before === null ? null : count(path, before)
    const a = after === null ? null : count(path, after)
    for (const key of ['japanese', 'ignored', 'hardLocale'] as const)
      delta[key] += (a?.[key] ?? 0) - (b?.[key] ?? 0)
    if ((a?.japanese ?? 0) > (b?.japanese ?? 0))
      grew.push(`  ${path}: ${b?.japanese ?? 0} → ${a?.japanese}`)
    problems.push(...(a?.badReasons ?? []).map((r) => `i18n-ignore の理由が語彙に無い (${IGNORE_REASONS.join(' / ')}): ${r}`))
  }

  if (delta.japanese > 0)
    problems.push(
      `日本語の直書きが ${delta.japanese} 行増えた。文言は locales/ja-JP.yml に足して i18n.ts / i18n.tsx で引く:\n${grew.join('\n')}`,
    )
  if (delta.ignored > 0)
    problems.push(
      `i18n-ignore が ${delta.ignored} 行増えた。AI プロンプトなどは専用ファイルに隔離し、scripts/i18n-lint.ts の EXEMPT_FILES に理由つきで足す`,
    )
  if (delta.hardLocale > 0)
    problems.push(
      `locale の直書き ('ja-JP' / 引数なしの toLocale*()) が ${delta.hardLocale} 箇所増えた。i18n.lang を渡す`,
    )

  for (const dir of MIGRATED_DIRS)
    for (const path of listFiles(dir).filter(isTarget)) {
      const text = readAt(head, path)
      const c = text === null ? null : count(path, text)
      if (c && c.japanese > 0)
        problems.push(`${path}: 移行済みディレクトリ (${dir}) に日本語の直書きが ${c.japanese} 行ある`)
    }

  if (problems.length) {
    console.error(`i18n-lint (基準 ${base.slice(0, 10)}):\n${problems.join('\n')}`)
    return 1
  }
  console.log(`i18n-lint: OK (基準 ${base.slice(0, 10)}、直書き ${delta.japanese >= 0 ? '+' : ''}${delta.japanese} 行)`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
