import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Command } from '@/commands/registry'
import { CAPABILITY_DECLARATIONS } from './declarations.generated'
import golden from './golden/tools.json'
import { toAnthropicTool } from './toolSchema'

/**
 * AI に渡す tool schema の golden (#1133)。
 *
 * Rust (notecore のエージェントループ) は `crates/notecore/src/capabilities/`
 * の宣言表から自前で tool schema を組む。JS と Rust が同じ宣言から同じ
 * schema を導くことを、両者が同じ tools.json を読んで検査する (権限の
 * golden と同じ方式)。期待値の正本は JS 側で、`pnpm gen:golden-tools` で
 * 採取して書き戻す。
 *
 * 宣言表 (builtins ではなく) から組むので、実行時に決まる enum
 * (`enumOf`、column.add の type など) は含まない。それはデバイス側が
 * schema を組むときに足す差分で、宣言の一致とは別の話。
 */

function toolFromDeclaration(id: keyof typeof CAPABILITY_DECLARATIONS) {
  const d = CAPABILITY_DECLARATIONS[id]
  const cmd = {
    id: d.id,
    signature: { description: d.description, params: d.params },
  } as unknown as Command
  return JSON.parse(JSON.stringify(toAnthropicTool(cmd)))
}

const UPDATE = process.env.UPDATE_GOLDEN_TOOLS === '1'
const ids = Object.keys(CAPABILITY_DECLARATIONS).sort() as Array<
  keyof typeof CAPABILITY_DECLARATIONS
>

describe('golden × AI tool schema (#1133)', () => {
  it('宣言表から組んだ tool 一覧が golden と一致する', () => {
    if (UPDATE) return
    expect(golden.tools, '`pnpm gen:golden-tools` で採取し直す').toEqual(
      ids.map(toolFromDeclaration),
    )
  })

  it('UPDATE_GOLDEN_TOOLS=1 で期待値を書き戻す', () => {
    if (!UPDATE) return
    const next = { tools: ids.map(toolFromDeclaration) }
    writeFileSync(
      join(__dirname, 'golden', 'tools.json'),
      `${JSON.stringify(next, null, 2)}\n`,
    )
  })
})
