// 「capability の宣言は crates/notecore/capabilities.json5 が正本で、生成物と実装が
// それに一致する」を機械検査に落とす (#1133)。
//
// - declarations.generated.ts と SKILLS.md の表が宣言ファイルから再生成したものと一致する
//   (openapi.json / bindings.ts と同じ snapshot 方式。ずれたら `pnpm gen:capabilities`)
// - 宣言のある id は全部 builtins に実装がある / builtins にある id は全部宣言がある
// - 宣言が `confirm: false` なのに実装が requiresConfirmation を渡していない
//   (確認の要否は宣言が正本。実装は表示内容を組み立てるだけ)
// - 宣言の `permissions` は権限語彙 (PERMISSION_KEYS) に含まれる

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_BUILTIN_CAPABILITIES } from '@/capabilities/builtins'
import {
  CAPABILITY_DECLARATIONS,
  CAPABILITY_IDS,
} from '@/capabilities/declarations.generated'
import { PERMISSION_KEYS } from '@/permissions/schema'
import {
  GENERATED_TS_PATH,
  generate,
  SKILLS_PATH,
} from '../../scripts/gen-capabilities.mjs'

const ROOT = resolve(import.meta.dirname, '../..')

describe('capability 宣言 (#1133)', () => {
  const { decls, generatedTs, skills } = generate()

  it('declarations.generated.ts は宣言ファイルから再生成したものと一致する', () => {
    const committed = readFileSync(GENERATED_TS_PATH, 'utf8')
    expect(
      committed,
      'declarations.generated.ts が古い — `pnpm gen:capabilities` を実行してコミットする',
    ).toBe(generatedTs)
  })

  it('SKILLS.md の capability 表は宣言ファイルから再生成したものと一致する', () => {
    const committed = readFileSync(SKILLS_PATH, 'utf8')
    expect(
      committed,
      'SKILLS.md の表が古い — `pnpm gen:capabilities` を実行してコミットする',
    ).toBe(skills)
  })

  it('宣言と builtins の実装が 1:1 に対応する', () => {
    const declared = new Set(CAPABILITY_IDS)
    const implemented = new Set(ALL_BUILTIN_CAPABILITIES.map((c) => c.id))
    const missingImpl = [...declared].filter((id) => !implemented.has(id))
    const missingDecl = [...implemented].filter((id) => !declared.has(id))
    expect(missingImpl, '宣言はあるが builtins に実装が無い').toEqual([])
    expect(
      missingDecl,
      'builtins にあるが宣言ファイルに無い (capabilities.json5 に足す)',
    ).toEqual([])
    expect(decls.length).toBe(ALL_BUILTIN_CAPABILITIES.length)
  })

  it('確認の要否は宣言が正本 (confirm: false なのに実装が確認を組み立てない)', () => {
    const bad = ALL_BUILTIN_CAPABILITIES.filter(
      (c) =>
        c.requiresConfirmation !== undefined &&
        c.requiresConfirmation !== false &&
        !CAPABILITY_DECLARATIONS[c.id as keyof typeof CAPABILITY_DECLARATIONS]
          ?.confirm,
    ).map((c) => c.id)
    expect(bad).toEqual([])
  })

  it('宣言の permissions は権限語彙に含まれる', () => {
    const keys = new Set<string>(PERMISSION_KEYS)
    const bad = decls.flatMap((d) =>
      d.permissions.filter((p) => !keys.has(p)).map((p) => `${d.id}: ${p}`),
    )
    expect(bad).toEqual([])
  })

  it('宣言ファイルは lint 対象のパスにある (検査対象を見失っていない)', () => {
    expect(
      readFileSync(resolve(ROOT, 'crates/notecore/capabilities.json5'), 'utf8'),
    ).toContain('capabilities:')
  })
})
