#!/usr/bin/env node
// 内蔵接続テンプレの宣言 (crates/notecore/connection_templates.json5) から生成物を作る (#1160)。
//
//   pnpm gen:connection-templates
//
// 生成するもの:
//   - src/data/connectionTemplates.generated.ts  (TS の宣言表 `BUILTIN_TEMPLATE_DECLS` と型)
//   - crates/notecore/src/connection_templates.generated.rs
//     (Rust の表。宛先ホストで引いてプロバイダー固有のリクエスト要件を適用する)
//
// 宣言ファイルが正本。生成物が最新かは tests/lint/connectionTemplates.test.ts が検査する
// (capabilities.json5 と同じ運用)。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DECLARATIONS_PATH = join(
  ROOT,
  'crates/notecore/connection_templates.json5',
)
export const GENERATED_TS_PATH = join(
  ROOT,
  'src/data/connectionTemplates.generated.ts',
)
export const GENERATED_RS_PATH = join(
  ROOT,
  'crates/notecore/src/connection_templates.generated.rs',
)

const AUTH_KINDS = new Set(['bearer', 'header', 'query', 'basic'])
const PROTOCOLS = new Set(['anthropic', 'openai-compat'])
const ID_RE = /^builtin:[a-z0-9-]+@\d+$/
// HTTP ヘッダー名 (token)。宣言は小文字に揃える (比較を単純にするため)
const HEADER_NAME_RE = /^[a-z0-9-]+$/

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** 宣言ファイルを読み、形を検査して返す (順序は宣言どおり = UI の並び) */
export function loadDeclarations(text = readFileSync(DECLARATIONS_PATH, 'utf8')) {
  const raw = JSON5.parse(text)
  if (!Array.isArray(raw)) throw new Error('connection_templates.json5 は配列')
  const seen = new Set()
  const out = []
  for (const t of raw) {
    const where = `template ${t?.id ?? '(no id)'}`
    if (typeof t.id !== 'string' || !ID_RE.test(t.id))
      throw new Error(`${where}: id は builtin:<id>@<version> 形式`)
    if (seen.has(t.id)) throw new Error(`${where}: id が重複`)
    seen.add(t.id)
    for (const key of ['name', 'icon', 'baseUrl', 'testPath', 'secretHelpUrl']) {
      if (typeof t[key] !== 'string' || t[key] === '')
        throw new Error(`${where}: ${key} は空でない文字列`)
    }
    if (!t.authType || !AUTH_KINDS.has(t.authType.kind))
      throw new Error(`${where}: authType.kind は ${[...AUTH_KINDS].join(' / ')}`)
    if (
      !Array.isArray(t.allowedHosts) ||
      t.allowedHosts.length === 0 ||
      t.allowedHosts.some((h) => typeof h !== 'string' || h !== h.toLowerCase())
    )
      throw new Error(`${where}: allowedHosts は小文字ホスト名の空でない配列`)
    const baseHost = hostOf(t.baseUrl)
    if (!baseHost || !t.allowedHosts.includes(baseHost))
      throw new Error(`${where}: baseUrl のホストが allowedHosts に無い`)
    const label = t.secretLabel
    const labelOk =
      (typeof label === 'string' && label !== '') ||
      (label && typeof label === 'object' && typeof label.i18n === 'string')
    if (!labelOk)
      throw new Error(`${where}: secretLabel は文字列か { i18n: '<key>' }`)
    if (t.protocol !== undefined && !PROTOCOLS.has(t.protocol))
      throw new Error(`${where}: protocol は ${[...PROTOCOLS].join(' / ')}`)
    if ((t.protocol === undefined) !== (t.defaultModel === undefined))
      throw new Error(`${where}: protocol と defaultModel はセット`)
    if (
      t.affinityHeader !== undefined &&
      (typeof t.affinityHeader !== 'string' || !HEADER_NAME_RE.test(t.affinityHeader))
    )
      throw new Error(`${where}: affinityHeader は小文字のヘッダー名`)
    const known = new Set([
      'id',
      'name',
      'icon',
      'baseUrl',
      'authType',
      'allowedHosts',
      'testPath',
      'secretLabel',
      'secretHelpUrl',
      'protocol',
      'defaultModel',
      'affinityHeader',
    ])
    for (const key of Object.keys(t)) {
      if (!known.has(key)) throw new Error(`${where}: 未知の項目 ${key}`)
    }
    out.push({
      id: t.id,
      name: t.name,
      icon: t.icon,
      baseUrl: t.baseUrl,
      authType: t.authType,
      allowedHosts: [...t.allowedHosts],
      testPath: t.testPath,
      secretLabel: label,
      secretHelpUrl: t.secretHelpUrl,
      protocol: t.protocol,
      defaultModel: t.defaultModel,
      affinityHeader: t.affinityHeader,
    })
  }
  return out
}

function ts(value) {
  return JSON.stringify(value)
}

/** TS の宣言表 (src/data/connectionTemplates.generated.ts)。i18n のラベルは辞書キーのまま
 *  出し、引くのは手書きの connectionTemplates.ts (辞書の参照検査が生成物を見ないため) */
export function renderTs(decls) {
  const labelKeys = [
    ...new Set(
      decls
        .map((t) => t.secretLabel)
        .filter((l) => typeof l !== 'string')
        .map((l) => l.i18n),
    ),
  ].sort()
  const lines = [
    '// 生成物 — 手で編集しない。正本は crates/notecore/connection_templates.json5、',
    '// 生成は `pnpm gen:connection-templates` (scripts/gen-connection-templates.mjs)。',
    '// 生成物が最新かは tests/lint/connectionTemplates.test.ts が検査する (#1160)。',
    '',
    "import type { AuthType, ConnectionProtocol } from '@/bindings'",
    '',
    '/** secret 入力欄のラベルに使う辞書キー (`_connectionTemplates.<key>`) */',
    `export type SecretLabelKey = ${labelKeys.map(ts).join(' | ')}`,
    '',
    'export interface ConnectionTemplateDecl {',
    '  /** `builtin:<id>@<version>` 形式の識別子。 */',
    '  id: string',
    '  /** 表示名。 */',
    '  name: string',
    '  /**',
    '   * favicon 取得に失敗したときの fallback アイコン (`ti ti-<icon>`)。',
    '   * 通常は baseUrl host の favicon を表示する (`faviconUrl`)。',
    '   */',
    '  icon: string',
    '  /** デフォルト baseUrl。 */',
    '  baseUrl: string',
    '  /** デフォルト authType。 */',
    '  authType: AuthType',
    '  /** デフォルト allowedHosts。 */',
    '  allowedHosts: string[]',
    '  /** 疎通テストに使うパス (自分の身元を返すエンドポイント)。 */',
    '  testPath: string',
    '  /** secret 入力欄のラベル (固定文字列か辞書キー)。 */',
    '  secretLabel: string | { i18n: SecretLabelKey }',
    '  /** secret 発行手順への URL。 */',
    '  secretHelpUrl: string',
    '  /**',
    '   * LLM プロトコル。設定すると AI プロバイダー接続として扱われ、',
    '   * AI 設定の接続ピッカーに表示される。汎用 API テンプレでは未設定。',
    '   */',
    '  protocol?: ConnectionProtocol',
    '  /** AI 設定で接続を選んだときに初期表示するモデル名。 */',
    '  defaultModel?: string',
    '  /**',
    '   * 会話アフィニティ ID を載せるヘッダー名 (#1160)。適用は Rust 側が',
    '   * 宛先ホストで判定するので、フロントは表示にしか使わない。',
    '   */',
    '  affinityHeader?: string',
    '}',
    '',
    'export const BUILTIN_TEMPLATE_DECLS: readonly ConnectionTemplateDecl[] = [',
  ]
  for (const t of decls) {
    lines.push('  {')
    lines.push(`    id: ${ts(t.id)},`)
    lines.push(`    name: ${ts(t.name)},`)
    lines.push(`    icon: ${ts(t.icon)},`)
    lines.push(`    baseUrl: ${ts(t.baseUrl)},`)
    lines.push(`    authType: ${ts(t.authType)},`)
    lines.push(`    allowedHosts: ${ts(t.allowedHosts)},`)
    lines.push(`    testPath: ${ts(t.testPath)},`)
    lines.push(`    secretLabel: ${ts(t.secretLabel)},`)
    lines.push(`    secretHelpUrl: ${ts(t.secretHelpUrl)},`)
    if (t.protocol !== undefined) {
      lines.push(`    protocol: ${ts(t.protocol)},`)
      lines.push(`    defaultModel: ${ts(t.defaultModel)},`)
    }
    if (t.affinityHeader !== undefined) {
      lines.push(`    affinityHeader: ${ts(t.affinityHeader)},`)
    }
    lines.push('  },')
  }
  lines.push(']', '')
  return lines.join('\n')
}

/** Rust の文字列リテラル */
function rs(value) {
  let out = '"'
  for (const ch of value) {
    const c = ch.codePointAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (c < 0x20 || c === 0x7f) out += `\\u{${c.toString(16)}}`
    else out += ch
  }
  return `${out}"`
}

/** Rust の表 (crates/notecore/src/connection_templates.generated.rs、connection_templates.rs が include! する) */
export function renderRs(decls) {
  const lines = [
    '// 生成物 — 手で編集しない。正本は crates/notecore/connection_templates.json5、',
    '// 生成は `pnpm gen:connection-templates` (scripts/gen-connection-templates.mjs)。',
    '// 型は connection_templates.rs。TS 側 (src/data/connectionTemplates.generated.ts) と',
    '// 同じ宣言から生成する (#1160)。',
    '',
    'pub static CONNECTION_TEMPLATES: &[ConnectionTemplateDecl] = &[',
  ]
  for (const t of decls) {
    const header = t.affinityHeader === undefined ? 'None' : `Some(${rs(t.affinityHeader)})`
    lines.push(
      '    ConnectionTemplateDecl {',
      `        id: ${rs(t.id)},`,
      `        allowed_hosts: &[${t.allowedHosts.map(rs).join(', ')}],`,
      `        affinity_header: ${header},`,
      '    },',
    )
  }
  lines.push('];', '')
  return lines.join('\n')
}

export function generate() {
  const decls = loadDeclarations()
  return {
    decls,
    generatedTs: renderTs(decls),
    generatedRs: renderRs(decls),
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { decls, generatedTs, generatedRs } = generate()
  writeFileSync(GENERATED_TS_PATH, generatedTs)
  writeFileSync(GENERATED_RS_PATH, generatedRs)
  console.log(`gen-connection-templates: ${decls.length} templates`)
}
