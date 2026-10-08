#!/usr/bin/env node
// コードマップ (CODEMAP.md) を正本のファイルから生成する (#895)。
//
// 構造の一覧 (種別・ストア・設定ファイル等) は手で書くと書いた瞬間から腐る。
// 正本はすでにコードにあるので、ここで読んで並べるだけにする。数は書かない
// (並べれば数えられる)。人が書く価値のある「なぜ」は ARCHITECTURE.md /
// DEVELOPMENT.md に置く。
//
//   node scripts/gen-codemap.mjs          CODEMAP.md を書き直す
//   docs-lint は renderCodemap() と CODEMAP.md を突き合わせ、ずれていれば落とす

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'CODEMAP.md')

const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const code = (s) => `\`${s}\``
const link = (p) => `[${code(p)}](${p})`

function section(title, source, lines) {
  return [`## ${title}`, '', `正本: ${source}`, '', ...lines, ''].join('\n')
}

function crates() {
  const members = read('Cargo.toml').match(/members\s*=\s*\[([^\]]*)\]/)[1]
  const rows = [...members.matchAll(/"([^"]+)"/g)].map(([, dir]) => {
    const toml = read(join(dir, 'Cargo.toml'))
    const name = toml.match(/^name\s*=\s*"([^"]+)"/m)[1]
    const desc = toml.match(/^description\s*=\s*"([^"]+)"/m)?.[1] ?? ''
    return `| ${code(name)} | ${link(dir)} | ${desc} |`
  })
  return section('クレート', link('Cargo.toml') + ' の `members`', [
    '| クレート | 場所 | 説明 (Cargo.toml の description) |',
    '|---|---|---|',
    ...rows,
  ])
}

function columnTypes() {
  const src = read('src/components/deck/columnComponents.ts')
  const body = src.match(/BUILTIN_COLUMN_LOADERS[^{]*\{([\s\S]*?)\n\}/)[1]
  const rows = [...body.matchAll(/(\w+):\s*\(\)\s*=>\s*import\('@\/([^']+)'\)/g)].map(
    ([, type, path]) => `| ${code(type)} | ${link(`src/${path}`)} |`,
  )
  return section('カラム種別', link('src/components/deck/columnComponents.ts') + ' (`BuiltinColumnType` → コンポーネント)', [
    '| 種別 | コンポーネント |',
    '|---|---|',
    ...rows,
  ])
}

function windowTypes() {
  const src = read('src/windows/registry.ts')
  const body = src.slice(src.indexOf('WINDOW_REGISTRY'))
  const types = [...body.matchAll(/^ {2}'?([\w-]+)'?: \{/gm)].map(([, t]) => code(t))
  return section('ウィンドウ種別', link('src/windows/registry.ts') + ' の `WINDOW_REGISTRY`', [
    types.join(' / '),
  ])
}

function stores() {
  const dir = 'src/stores'
  const rows = readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .sort()
    .flatMap((f) => {
      const id = read(join(dir, f)).match(/defineStore\(\s*'([^']+)'/)?.[1]
      return id ? [`| ${code(id)} | ${link(`${dir}/${f}`)} |`] : []
    })
  return section('Pinia ストア', link(dir) + ' の `defineStore`', [
    'store は「購読 + キャッシュ + UI 状態」だけを持つ。純ロジックは下の service 層に置く (#782)。',
    '',
    '| id | ファイル |',
    '|---|---|',
    ...rows,
  ])
}

function walk(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`
    return e.isDirectory() ? walk(p) : [p]
  })
}

function services() {
  const dir = 'src/services'
  const files = walk(dir)
  const isTest = (f) => /\.(dom\.)?test\.ts$/.test(f)
  const rows = files
    .filter((f) => f.endsWith('.ts') && !isTest(f) && !f.endsWith('.d.ts'))
    .sort()
    .map((f) => {
      const base = f.replace(/\.ts$/, '')
      const tests = files.filter((t) => t === `${base}.test.ts` || t === `${base}.dom.test.ts`)
      return `| ${link(f)} | ${tests.map(link).join(' ') || '—'} |`
    })
  return section('service 層と仕様テスト', link(dir), [
    '正規化・マイグレーション・マージ規則・codec などの純ロジック。隣のテストがそのまま仕様書になっている — 挙動を知りたいときはテストから読む (#782 / #895)。',
    '',
    '| service | テスト |',
    '|---|---|',
    ...rows,
  ])
}

function settingsFiles() {
  const src = read('crates/notecore/src/settings_store.rs')
  const subdirs = [...src.match(/ALLOWED_SUBDIRS[^=]*=\s*&\[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(
    ([, d]) => `${code(`${d}/`)}`,
  )
  const body = src.match(/pub const ROOT_FILES[^=]*=\s*&\[([\s\S]*?)\n\];/)[1]
  const rows = []
  for (const m of body.matchAll(/(core|device)\("([^"]+)"\)|name:\s*"([^"]+)",\s*side:\s*Side::(\w+),\s*backup:\s*(\w+)/g)) {
    if (m[1]) rows.push(`| ${code(m[2])} | ${m[1] === 'core' ? 'Core' : 'Device'} | ✓ |`)
    else rows.push(`| ${code(m[3])} | ${m[4]} | ${m[5] === 'true' ? '✓' : '—'} |`)
  }
  return section('設定ファイル', link('crates/notecore/src/settings_store.rs') + ' の `ROOT_FILES` / `ALLOWED_SUBDIRS`', [
    '`side` は「デバイスが 1 台も繋がっていなくても意味を持つか」(Core) か手元側 (Device) か。バックアップの例外 (`notemaid/` の人格と記憶、Vault の `connections.json`) は DESIGN.md の「ファイル構造」を参照。',
    '',
    '| ルートファイル | side | バックアップ |',
    '|---|---|---|',
    ...rows,
    '',
    `サブディレクトリ: ${subdirs.join(' / ')}`,
  ])
}

function generatedIndexes() {
  return section('生成済みの一覧 (ここには写さない)', 'それぞれのファイル', [
    `- Tauri コマンドと型: ${link('src/bindings.ts')} (tauri-specta の生成物)`,
    `- capability と権限キー: ${link('crates/notecore/capabilities.json5')} (TS / Rust の表はここから生成)`,
    `- HTTP API: ${link('src-tauri/openapi.json')}`,
    `- UI 文言: ${link('locales/ja-JP.yml')}`,
  ])
}

/** CODEMAP.md の中身。docs-lint が鮮度の検査に使う */
export function renderCodemap() {
  return [
  '# コードマップ',
  '',
  '<!-- このファイルは scripts/gen-codemap.mjs の生成物。手で編集せず `pnpm gen:codemap` で作り直す -->',
  '',
  'リポジトリの構造の一覧。正本のファイルから生成していて、構造が変わると `pnpm lint:docs` が再生成を求める。設計の理由は [ARCHITECTURE.md](ARCHITECTURE.md) と [DEVELOPMENT.md](DEVELOPMENT.md) を読む。',
  '',
  crates(),
  columnTypes(),
  windowTypes(),
  stores(),
  services(),
  settingsFiles(),
  generatedIndexes(),
  ]
    .join('\n')
    .replace(/\n+$/, '\n')
}

export const CODEMAP_PATH = OUT

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, renderCodemap())
  console.log(`${relative(ROOT, OUT)} を書いた`)
}
