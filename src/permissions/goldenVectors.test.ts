import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ProfiledPrincipalId } from '@/permissions/principal'
import { PERMISSION_KEYS } from '@/permissions/schema'
import {
  defaultPermissionsFile,
  parsePermissionsFile,
  resolveProfiledIn,
} from '@/permissions/store'

import golden from './golden/vectors.json'

/**
 * 権限解決の golden vector (#1099)。
 *
 * Rust 側 external gate は permissions.json5 をリクエストごとに直接読んで
 * 自前で解決する。JS (dispatcher) と Rust (HTTP gate) が同じ本文から同じ
 * granted 集合を導くことを、両者が同じ vectors.json を読んで検査する
 * (カラムクエリの golden と同じ方式)。
 *
 * 期待値の正本は JS 側。`UPDATE_GOLDEN_PERMISSIONS=1` で採取して書き戻す
 * (`pnpm gen:golden-permissions`)。
 */

interface GoldenCase {
  name: string
  principal: ProfiledPrincipalId
  file: string | null
  granted: string[]
}

function grantedKeys(file: string | null, id: ProfiledPrincipalId): string[] {
  const parsed =
    file === null ? defaultPermissionsFile() : parsePermissionsFile(file).file
  const map = resolveProfiledIn(parsed, id)
  return PERMISSION_KEYS.filter((k) => map[k]).sort()
}

const UPDATE = process.env.UPDATE_GOLDEN_PERMISSIONS === '1'

describe('golden vectors × permissions resolve (#1099)', () => {
  const cases = golden.cases as GoldenCase[]

  it('ケース名が一意である', () => {
    const names = cases.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keys が PERMISSION_KEYS と一致する (Rust 側のキー集合検査の基準)', () => {
    if (UPDATE) return
    expect(golden.keys).toEqual([...PERMISSION_KEYS])
  })

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    if (UPDATE) return
    expect(grantedKeys(c.file, c.principal)).toEqual(c.granted)
  })

  it('UPDATE_GOLDEN_PERMISSIONS=1 で期待値を書き戻す', () => {
    if (!UPDATE) return
    const next = {
      ...golden,
      keys: [...PERMISSION_KEYS],
      cases: cases.map((c) => ({
        ...c,
        granted: grantedKeys(c.file, c.principal),
      })),
    }
    writeFileSync(
      join(__dirname, 'golden', 'vectors.json'),
      `${JSON.stringify(next, null, 2)}\n`,
    )
  })
})
