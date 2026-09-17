// 「SKILLS.md の capability 一覧はレジストリと一致する」を機械検査に落とす (#1098)。
//
// capability の宣言は実装 (builtins) が正本だが、AI とユーザーが読む一覧は
// SKILLS.md §4.0 の表に手書きされている。表は誰も同期しないので、監査時点で
// コードにあって表に無い capability が複数あった。生成に切り替えるまでは、
// 少なくとも欠落と幽霊を CI で落とす。
//
// 表の「用途」列には permission キー (`notes.write` 等) も backtick で書かれる
// ので、表側の ID は「capability か permission キーのどちらか」なら通す。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_BUILTIN_CAPABILITIES } from '@/capabilities/builtins'
import { PERMISSION_KEYS } from '@/permissions/schema'

const ROOT = resolve(import.meta.dirname, '../..')

function capabilityTable(): string {
  const md = readFileSync(resolve(ROOT, 'SKILLS.md'), 'utf-8')
  const start = md.indexOf('### 4.0 capability 一覧')
  expect(
    start,
    'SKILLS.md に "### 4.0 capability 一覧" が無い',
  ).toBeGreaterThan(-1)
  const rest = md.slice(md.indexOf('\n', start) + 1)
  const end = rest.search(/^###? /m)
  return end === -1 ? rest : rest.slice(0, end)
}

function idsInTable(): Set<string> {
  const ids = new Set<string>()
  for (const m of capabilityTable().matchAll(
    /`([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)`/g,
  ))
    ids.add(m[1])
  return ids
}

describe('SKILLS.md §4.0 の capability 一覧', () => {
  const inDoc = idsInTable()
  const inCode = new Set(ALL_BUILTIN_CAPABILITIES.map((c) => c.id))
  const permissionKeys = new Set<string>(PERMISSION_KEYS)

  it('レジストリの capability は全て表にある', () => {
    const missing = [...inCode].filter((id) => !inDoc.has(id)).sort()
    expect(missing).toEqual([])
  })

  it('表の ID は capability か permission キーのどちらか (幽霊が無い)', () => {
    const ghost = [...inDoc]
      .filter((id) => !inCode.has(id) && !permissionKeys.has(id))
      .sort()
    expect(ghost).toEqual([])
  })
})
