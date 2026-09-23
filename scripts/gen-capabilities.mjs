#!/usr/bin/env node
// capability 宣言 (crates/notecore/capabilities.json5) から生成物を作る (#1133)。
//
//   pnpm gen:capabilities
//
// 生成するもの:
//   - src/capabilities/declarations.generated.ts  (TS の宣言表と CapabilityId 型)
//   - SKILLS.md §4.0 の表 (<!-- capabilities:begin --> 〜 <!-- capabilities:end -->)
//
// 宣言ファイルが正本。builtins は `implement(id, { execute, ... })` で振る舞いだけを
// 結び付ける。生成物が最新かは tests/lint/capabilityDeclarations.test.ts が検査する
// (openapi.json / bindings.ts と同じ運用)。Rust 側の生成は次の段階で足す。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DECLARATIONS_PATH = join(ROOT, 'crates/notecore/capabilities.json5')
export const GENERATED_TS_PATH = join(
  ROOT,
  'src/capabilities/declarations.generated.ts',
)
export const SKILLS_PATH = join(ROOT, 'SKILLS.md')
const BEGIN = '<!-- capabilities:begin -->'
const END = '<!-- capabilities:end -->'

const EXEC_KINDS = new Set(['core', 'device', 'live'])
const CATEGORIES = new Set([
  'general',
  'navigation',
  'column',
  'account',
  'note',
  'window',
])
const PARAM_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array'])

/** 宣言ファイルを読み、placeholder を展開して検証済みの一覧を返す */
export function loadDeclarations(text = readFileSync(DECLARATIONS_PATH, 'utf8')) {
  const doc = JSON5.parse(text)
  if (doc.schemaVersion !== 1)
    throw new Error(`unsupported schemaVersion ${doc.schemaVersion}`)
  const placeholders = doc.placeholders ?? {}
  const expand = (s) =>
    s.replace(/\$\{(\w+)\}/g, (_, name) => {
      if (!(name in placeholders)) throw new Error(`unknown placeholder ${name}`)
      return placeholders[name]
    })
  const ID_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/
  const out = []
  for (const [id, d] of Object.entries(doc.capabilities)) {
    if (!ID_RE.test(id)) throw new Error(`bad capability id: ${id}`)
    if (typeof d.label !== 'string' || !d.label)
      throw new Error(`${id}: label is required`)
    if (!CATEGORIES.has(d.category))
      throw new Error(`${id}: bad category ${d.category}`)
    if (!Array.isArray(d.permissions))
      throw new Error(`${id}: permissions must be an array`)
    const exec = d.exec ?? 'device'
    if (!EXEC_KINDS.has(exec)) throw new Error(`${id}: bad exec ${exec}`)
    const params = {}
    for (const [k, p] of Object.entries(d.params ?? {})) {
      if (!PARAM_TYPES.has(p.type))
        throw new Error(`${id}: param ${k} has bad type ${p.type}`)
      params[k] = {
        type: p.type,
        description: expand(p.description ?? ''),
        ...(p.optional ? { optional: true } : {}),
        ...(p.enum ? { enum: [...p.enum] } : {}),
      }
    }
    out.push({
      id,
      label: d.label,
      category: d.category,
      icon: d.icon ?? 'ti-bolt',
      permissions: [...d.permissions],
      aiTool: d.aiTool !== false,
      confirm: d.confirm === true,
      actsAsAccount: d.actsAsAccount === true,
      cheap: d.cheap === true,
      visible: d.visible === true,
      exec,
      description: expand(d.description ?? ''),
      params,
      returns: d.returns
        ? {
            type: d.returns.type,
            ...(d.returns.description
              ? { description: d.returns.description }
              : {}),
          }
        : undefined,
    })
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

function ts(value) {
  return JSON.stringify(value)
}

export function renderTs(decls) {
  const lines = []
  lines.push(
    '// 生成物 — 手で編集しない。正本は crates/notecore/capabilities.json5、',
    '// 生成は `pnpm gen:capabilities` (scripts/gen-capabilities.mjs)。',
    '// 生成物が最新かは tests/lint/capabilityDeclarations.test.ts が検査する (#1133)。',
    '',
    "import type { Command } from '@/commands/registry'",
    "import type { ParameterDef, ReturnTypeDef } from '@/capabilities/types'",
    "import type { PermissionKey } from '@/permissions/schema'",
    '',
    '/** capability の実行属性 (#1106 §4.8): core = notecore 単独で実行できる /',
    ' *  device = 接続中のデバイスに実行要求する (UI 系・plugin 由来) / live = ライブ接続必須 */',
    "export type CapabilityExec = 'core' | 'device' | 'live'",
    '',
    'export interface CapabilityDeclaration {',
    '  id: CapabilityId',
    '  label: string',
    "  category: Command['category']",
    '  icon: string',
    '  permissions: readonly PermissionKey[]',
    '  aiTool: boolean',
    '  /** 確認が要りうるか。表示内容の組み立ては実装側 (requiresConfirmation の関数形) */',
    '  confirm: boolean',
    '  actsAsAccount: boolean',
    '  cheap: boolean',
    '  /** コマンドパレットに並べるか */',
    '  visible: boolean',
    '  exec: CapabilityExec',
    '  description: string',
    '  params: Record<string, ParameterDef>',
    '  returns?: ReturnTypeDef',
    '}',
    '',
    'export type CapabilityId =',
  )
  for (const d of decls) lines.push(`  | ${ts(d.id)}`)
  lines.push('')
  lines.push(
    'export const CAPABILITY_IDS: readonly CapabilityId[] = [',
    ...decls.map((d) => `  ${ts(d.id)},`),
    ']',
    '',
    'export const CAPABILITY_DECLARATIONS: Record<CapabilityId, CapabilityDeclaration> = {',
  )
  for (const d of decls) {
    lines.push(`  ${ts(d.id)}: {`)
    lines.push(`    id: ${ts(d.id)},`)
    lines.push(`    label: ${ts(d.label)},`)
    lines.push(`    category: ${ts(d.category)},`)
    lines.push(`    icon: ${ts(d.icon)},`)
    lines.push(`    permissions: ${ts(d.permissions)},`)
    lines.push(`    aiTool: ${d.aiTool},`)
    lines.push(`    confirm: ${d.confirm},`)
    lines.push(`    actsAsAccount: ${d.actsAsAccount},`)
    lines.push(`    cheap: ${d.cheap},`)
    lines.push(`    visible: ${d.visible},`)
    lines.push(`    exec: ${ts(d.exec)},`)
    lines.push(`    description: ${ts(d.description)},`)
    lines.push(`    params: ${ts(d.params)},`)
    if (d.returns) lines.push(`    returns: ${ts(d.returns)},`)
    lines.push('  },')
  }
  lines.push('}', '')
  return lines.join('\n')
}

export function renderSkillsTable(decls) {
  const bySubject = new Map()
  for (const d of decls) {
    const subject = d.id.slice(0, d.id.indexOf('.'))
    if (!bySubject.has(subject)) bySubject.set(subject, [])
    bySubject.get(subject).push(d)
  }
  const rows = [
    `${BEGIN}`,
    '<!-- 生成物: 正本は crates/notecore/capabilities.json5、生成は pnpm gen:capabilities -->',
    '',
    '| subject | capability ID | 用途 | 権限 | 確認 |',
    '|---|---|---|---|---|',
  ]
  for (const [subject, list] of [...bySubject.entries()].sort()) {
    for (const d of list) {
      const perms = d.permissions.length
        ? d.permissions.map((p) => `\`${p}\``).join(', ')
        : '—'
      const confirm = d.confirm ? 'あり' : '—'
      const ai = d.aiTool ? '' : ' (AI からは呼べない)'
      rows.push(
        `| ${subject} | \`${d.id}\` | ${d.label}${ai} | ${perms} | ${confirm} |`,
      )
    }
  }
  rows.push('', END)
  return rows.join('\n')
}

export function spliceSkills(md, table) {
  const b = md.indexOf(BEGIN)
  const e = md.indexOf(END)
  if (b < 0 || e < 0)
    throw new Error(`SKILLS.md に ${BEGIN} / ${END} のマーカーが無い`)
  return md.slice(0, b) + table + md.slice(e + END.length)
}

export function generate() {
  const decls = loadDeclarations()
  const generatedTs = `${renderTs(decls)}`
  const skills = spliceSkills(readFileSync(SKILLS_PATH, 'utf8'), renderSkillsTable(decls))
  return { decls, generatedTs, skills }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { decls, generatedTs, skills } = generate()
  writeFileSync(GENERATED_TS_PATH, generatedTs)
  writeFileSync(SKILLS_PATH, skills)
  console.log(`gen-capabilities: ${decls.length} capabilities`)
}
