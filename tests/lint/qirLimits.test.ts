// 「QIR の上限定数は TS と Rust で同値」を機械検査に落とす (#1098)。
//
// QIR の型は Rust が正本で specta 経由で bindings.ts に載るが、意味を決める
// 上限 (スキーマ世代 / ノード数 / 深さ) は定数なので生成に乗らず、両側に
// 手書きで置かれている。片方だけ変えると JS 評価器と Rust 評価器で通る
// クエリが食い違う。golden vector は値の一致までは見ないので、ここで見る。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const NAMES = ['QIR_SCHEMA_VERSION', 'QIR_MAX_NODES', 'QIR_MAX_DEPTH'] as const

function tsConstants(): Record<string, number> {
  const src = readFileSync(
    resolve(ROOT, 'src/services/columnQuery/compiler.ts'),
    'utf-8',
  )
  const out: Record<string, number> = {}
  for (const name of NAMES) {
    const m = src.match(new RegExp(`export const ${name} = (\\d+)`))
    expect(m, `${name} in compiler.ts`).not.toBeNull()
    if (m) out[name] = Number(m[1])
  }
  return out
}

function rustConstants(): Record<string, number> {
  const src = readFileSync(
    resolve(ROOT, 'crates/notecore/src/commands/column_query.rs'),
    'utf-8',
  )
  const out: Record<string, number> = {}
  for (const name of NAMES) {
    const m = src.match(new RegExp(`pub const ${name}: u32 = (\\d+);`))
    expect(m, `${name} in column_query.rs`).not.toBeNull()
    if (m) out[name] = Number(m[1])
  }
  return out
}

describe('QIR の上限定数', () => {
  it('TS (compiler.ts) と Rust (column_query.rs) で同値', () => {
    expect(tsConstants()).toEqual(rustConstants())
  })
})
