#!/usr/bin/env node
// capability 宣言 (crates/notecore/capabilities.json5) から生成物を作る (#1133)。
//
//   pnpm gen:capabilities
//
// 生成するもの:
//   - src/capabilities/declarations.generated.ts  (TS の宣言表と CapabilityId 型)
//   - crates/notecore/src/capabilities/generated.rs  (Rust の宣言表。型は同 mod.rs)
//   - SKILLS.md §4.0 の表 (<!-- capabilities:begin --> 〜 <!-- capabilities:end -->)
//   - src/permissions/keys.generated.ts / crates/notecore/src/permissions_keys.generated.rs
//     (権限キーの語彙と preset / floor / deny の集合。TS と Rust で同じ宣言から)
//
// 宣言ファイルが正本。builtins は `implement(id, { execute, ... })` で振る舞いだけを
// 結び付ける。生成物が最新かは tests/lint/capabilityDeclarations.test.ts が検査する
// (openapi.json / bindings.ts と同じ運用)。

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
export const PERMISSION_KEYS_TS_PATH = join(
  ROOT,
  'src/permissions/keys.generated.ts',
)
export const CAPABILITIES_RS_PATH = join(
  ROOT,
  'crates/notecore/src/capabilities/generated.rs',
)
export const PERMISSION_KEYS_RS_PATH = join(
  ROOT,
  'crates/notecore/src/permissions_keys.generated.rs',
)
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

const PRESET_NAMES = ['readonly', 'safe']
const KEY_FLAGS = [
  'highRisk',
  'aiInstruction',
  'thirdPartyDeny',
  'externalReadFloor',
  'localRead',
]

/** 宣言ファイルの permissions 節 (権限キーの語彙) を検証して返す */
export function loadPermissionKeys(text = readFileSync(DECLARATIONS_PATH, 'utf8')) {
  const doc = JSON5.parse(text)
  const out = []
  for (const [key, d] of Object.entries(doc.permissions ?? {})) {
    if (!/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)*$/.test(key))
      throw new Error(`bad permission key: ${key}`)
    const presets = d.presets ?? []
    for (const p of presets)
      if (!PRESET_NAMES.includes(p))
        throw new Error(`${key}: bad preset ${p}`)
    if (presets.includes('readonly') && !presets.includes('safe'))
      throw new Error(`${key}: readonly なら safe でも ON (safe ⊇ readonly)`)
    const entry = { key, readonly: presets.includes('readonly'), safe: presets.includes('safe') }
    for (const f of KEY_FLAGS) entry[f] = d[f] === true
    if (entry.aiInstruction && !entry.thirdPartyDeny)
      throw new Error(`${key}: aiInstruction なら thirdPartyDeny (第三者に恒久 deny)`)
    out.push(entry)
  }
  if (out.length === 0) throw new Error('permissions 節が空')
  return out
}

/** 宣言ファイルを読み、placeholder を展開して検証済みの一覧を返す */
export function loadDeclarations(text = readFileSync(DECLARATIONS_PATH, 'utf8')) {
  const doc = JSON5.parse(text)
  if (doc.schemaVersion !== 1)
    throw new Error(`unsupported schemaVersion ${doc.schemaVersion}`)
  const knownKeys = new Set(Object.keys(doc.permissions ?? {}))
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
    for (const p of d.permissions)
      if (!knownKeys.has(p))
        throw new Error(`${id}: unknown permission key ${p}`)
    const exec = d.exec ?? 'device'
    if (!EXEC_KINDS.has(exec)) throw new Error(`${id}: bad exec ${exec}`)
    const destinations = [...(d.destinations ?? [])]
    for (const name of destinations)
      if (!(name in (d.params ?? {})))
        throw new Error(`${id}: destination ${name} is not a param`)
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
      untrusted: d.untrusted === true,
      unattended: d.unattended === true,
      destinations,
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
  // code unit 順 (Rust 側の二分探索 / golden の並びと同じ)
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
    '  /** 結果に他人の内容を含みうる読取 (読んだセッションを tainted にする) */',
    '  untrusted: boolean',
    '  /** 無人実行 (HEARTBEAT) でも確認なしで走ってよい (権限だけで gate) */',
    '  unattended: boolean',
    '  /** 書き込みの宛先になる引数 (値の出所を判定する) */',
    '  destinations: readonly string[]',
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
    lines.push(`    untrusted: ${d.untrusted},`)
    lines.push(`    unattended: ${d.unattended},`)
    lines.push(`    destinations: ${ts(d.destinations)},`)
    lines.push(`    exec: ${ts(d.exec)},`)
    lines.push(`    description: ${ts(d.description)},`)
    lines.push(`    params: ${ts(d.params)},`)
    if (d.returns) lines.push(`    returns: ${ts(d.returns)},`)
    lines.push('  },')
  }
  lines.push('}', '')
  return lines.join('\n')
}

/** Rust の文字列リテラル (通常文字列。`\u{..}` で制御文字を逃がす) */
function rs(value) {
  let out = '"'
  for (const ch of value) {
    const c = ch.codePointAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f) out += `\\u{${c.toString(16)}}`
    else out += ch
  }
  return `${out}"`
}

const pascal = (s) => s[0].toUpperCase() + s.slice(1)

/** Rust の宣言表 (crates/notecore/src/capabilities/generated.rs、mod.rs が include! する) */
export function renderRs(decls) {
  const lines = [
    '// 生成物 — 手で編集しない。正本は crates/notecore/capabilities.json5、',
    '// 生成は `pnpm gen:capabilities` (scripts/gen-capabilities.mjs)。型は mod.rs。',
    '// TS 側 (src/capabilities/declarations.generated.ts) と同じ宣言から生成され、',
    '// AI に渡す tool schema の一致は src/capabilities/golden/tools.json で検査する (#1133)。',
    '',
    'pub static CAPABILITIES: &[CapabilityDecl] = &[',
  ]
  for (const d of decls) {
    lines.push(
      '    CapabilityDecl {',
      `        id: ${rs(d.id)},`,
      `        label: ${rs(d.label)},`,
      `        category: Category::${pascal(d.category)},`,
      `        icon: ${rs(d.icon)},`,
      `        permissions: &[${d.permissions.map(rs).join(', ')}],`,
      `        ai_tool: ${d.aiTool},`,
      `        confirm: ${d.confirm},`,
      `        acts_as_account: ${d.actsAsAccount},`,
      `        cheap: ${d.cheap},`,
      `        visible: ${d.visible},`,
      `        untrusted: ${d.untrusted},`,
      `        unattended: ${d.unattended},`,
      `        destinations: &[${d.destinations.map(rs).join(', ')}],`,
      `        exec: Exec::${pascal(d.exec)},`,
      `        description: ${rs(d.description)},`,
    )
    const params = Object.entries(d.params)
    if (params.length === 0) {
      lines.push('        params: &[],')
    } else {
      lines.push('        params: &[')
      for (const [name, p] of params) {
        const enumValues = p.enum
          ? `Some(&[${p.enum.map(rs).join(', ')}])`
          : 'None'
        lines.push(
          '            ParamDecl {',
          `                name: ${rs(name)},`,
          `                ty: ParamType::${pascal(p.type)},`,
          `                description: ${rs(p.description)},`,
          `                optional: ${p.optional === true},`,
          `                enum_values: ${enumValues},`,
          '            },',
        )
      }
      lines.push('        ],')
    }
    if (d.returns) {
      const desc = d.returns.description
        ? `Some(${rs(d.returns.description)})`
        : 'None'
      lines.push(
        '        returns: Some(ReturnDecl {',
        `            ty: ReturnType::${pascal(d.returns.type)},`,
        `            description: ${desc},`,
        '        }),',
      )
    } else {
      lines.push('        returns: None,')
    }
    lines.push('    },')
  }
  lines.push('];', '')
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

export function renderPermissionKeysTs(keys) {
  const list = (pred) => keys.filter(pred).map((k) => `  ${ts(k.key)},`)
  const presetMap = (pred) =>
    keys.map((k) => `    ${ts(k.key)}: ${pred(k)},`)
  return [
    '// 生成物 — 手で編集しない。正本は crates/notecore/capabilities.json5 の permissions 節、',
    '// 生成は `pnpm gen:capabilities`。意味 (preset / floor / deny の扱い) は schema.ts 側の',
    '// コメントと #712 を参照 (#1133)。',
    '',
    'export const PERMISSION_KEYS = [',
    ...keys.map((k) => `  ${ts(k.key)},`),
    '] as const',
    'export type PermissionKey = (typeof PERMISSION_KEYS)[number]',
    '',
    'export const PERMISSION_PRESETS: Record<',
    "  'readonly' | 'safe' | 'full',",
    '  Record<PermissionKey, boolean>',
    '> = {',
    '  readonly: {',
    ...presetMap((k) => k.readonly),
    '  },',
    '  safe: {',
    ...presetMap((k) => k.safe),
    '  },',
    '  full: {',
    ...presetMap(() => true),
    '  },',
    '}',
    '',
    'export const HIGH_RISK_PERMISSION_KEYS: readonly PermissionKey[] = [',
    ...list((k) => k.highRisk),
    ']',
    '',
    'export const AI_INSTRUCTION_KEYS: readonly PermissionKey[] = [',
    ...list((k) => k.aiInstruction),
    ']',
    '',
    'export const THIRD_PARTY_DENY_KEYS: readonly PermissionKey[] = [',
    ...list((k) => k.thirdPartyDeny),
    ']',
    '',
    'export const EXTERNAL_READ_FLOOR: readonly PermissionKey[] = [',
    ...list((k) => k.externalReadFloor),
    ']',
    '',
    'export const LOCAL_READ_KEYS: readonly PermissionKey[] = [',
    ...list((k) => k.localRead),
    ']',
    '',
  ].join('\n')
}

export function renderPermissionKeysRs(keys) {
  const arr = (name, doc, pred) => [
    `/// ${doc}`,
    `pub const ${name}: &[&str] = &[`,
    ...keys.filter(pred).map((k) => `    ${ts(k.key)},`),
    '];',
    '',
  ]
  return [
    '// 生成物 — 手で編集しない。正本は crates/notecore/capabilities.json5 の permissions 節、',
    '// 生成は `pnpm gen:capabilities` (scripts/gen-capabilities.mjs)。JS 側 (src/permissions/',
    '// keys.generated.ts) と同じ宣言から生成され、解決結果の一致は golden vector で検査する (#1133)。',
    '',
    ...arr('PERMISSION_KEYS', '権限キーの語彙 (順序は golden の keys と同じ)。', () => true),
    ...arr('READONLY_KEYS', '`readonly` preset で ON になるキー。', (k) => k.readonly),
    ...arr('SAFE_EXTRA_KEYS', '`safe` preset で readonly に加えて ON になるキー。', (k) => k.safe && !k.readonly),
    ...arr('THIRD_PARTY_DENY_KEYS', '第三者 principal (plugin / external) への恒久 deny (#712 §3.7 / §3.8)。', (k) => k.thirdPartyDeny),
    ...arr('EXTERNAL_READ_FLOOR', 'external principal の Misskey コンテンツ read 下限 (#712 §5.3)。', (k) => k.externalReadFloor),
    ...arr('LOCAL_READ_KEYS', 'NoteDeck ローカル私的データの read キー (#712 §4.4)。', (k) => k.localRead),
  ].join('\n')
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
  const keys = loadPermissionKeys()
  const generatedTs = `${renderTs(decls)}`
  const skills = spliceSkills(readFileSync(SKILLS_PATH, 'utf8'), renderSkillsTable(decls))
  return {
    decls,
    keys,
    generatedTs,
    skills,
    generatedRs: renderRs(decls),
    permissionKeysTs: renderPermissionKeysTs(keys),
    permissionKeysRs: renderPermissionKeysRs(keys),
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const {
    decls,
    keys,
    generatedTs,
    generatedRs,
    skills,
    permissionKeysTs,
    permissionKeysRs,
  } = generate()
  writeFileSync(GENERATED_TS_PATH, generatedTs)
  writeFileSync(CAPABILITIES_RS_PATH, generatedRs)
  writeFileSync(SKILLS_PATH, skills)
  writeFileSync(PERMISSION_KEYS_TS_PATH, permissionKeysTs)
  writeFileSync(PERMISSION_KEYS_RS_PATH, permissionKeysRs)
  console.log(
    `gen-capabilities: ${decls.length} capabilities, ${keys.length} permission keys`,
  )
}
