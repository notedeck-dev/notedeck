// パフォーマンス設定の「死にノブ」検査 (#987)。
//
// 定義・既定値・設定 UI まで揃っているのに、実装のどこからも参照されていない
// ノブが存在した (絵文字キャッシュ関連の 2 つ)。ユーザーから見ると効いている
// ように見えて何も起きない。同じ事故は #921 の max_concurrent_fetches でも
// 起きている (生成時の定数で固定され、設定値が一生効かなかった)。
//
// 設定を足すときに「使う側の配線を忘れる」のは注意力の問題なので、機械検査に
// 落とす (#895 と同じ思想)。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import DEFAULTS from '@/defaults/performance.json5'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

/** 設定の定義そのもの。ここでの出現は「配線」に数えない */
const DEFINITION_FILES = [
  join(SRC, 'stores', 'performanceData.ts'),
  join(SRC, 'defaults', 'performance.json5'),
]

function collect(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path, ext)
    return ext.some((e) => entry.name.endsWith(e)) ? [path] : []
  })
}

const keys = Object.keys(DEFAULTS as Record<string, number>)

const STORE = join(SRC, 'stores', 'performance.ts')

const consumerFiles = collect(SRC, ['.ts', '.vue']).filter(
  (f) =>
    !f.endsWith('.test.ts') &&
    !f.endsWith('.dom.test.ts') &&
    !DEFINITION_FILES.includes(f),
)

/**
 * store 本体は「キーの型定義」と「Rust / CSS / telemetry への push」が同居する。
 * 型定義ブロックだけを落とし、残りは配線として数える。
 */
function stripKeyDeclarations(text: string): string {
  const from = text.indexOf('export interface PerformanceConfig {')
  if (from < 0) return text
  const to = text.indexOf('\n}', from)
  return to < 0 ? text : text.slice(0, from) + text.slice(to)
}

const consumerSources = consumerFiles.map((f) => {
  const text = readFileSync(f, 'utf8')
  return {
    path: relative(ROOT, f),
    text: f === STORE ? stripKeyDeclarations(text) : text,
  }
})

/**
 * そのノブを読んでいるファイル (相対パス)。
 * 消費側は `get('key')` のリテラル参照か、store 内の `c.key` /
 * `config.value.key` のプロパティ参照のどちらかで読む。
 */
function consumersOf(key: string): string[] {
  const ref = new RegExp(`['"\`]${key}['"\`]|\\.${key}\\b`)
  return consumerSources.filter((s) => ref.test(s.text)).map((s) => s.path)
}

describe('パフォーマンス設定の配線 (#987)', () => {
  it('検査対象のノブを取りこぼしていない', () => {
    expect(keys.length).toBeGreaterThan(40)
    // 型定義ブロックの除去が効いていること (効いていないと全ノブが配線済みに見える)
    const store = consumerSources.find((s) => s.path === relative(ROOT, STORE))
    expect(store?.text).not.toContain('export interface PerformanceConfig {')
    expect(store?.text).toContain('frameTelemetry.start(')
  })

  it('すべてのノブが実装から参照されている (死にノブが無い)', () => {
    const dead = keys.filter((key) => consumersOf(key).length === 0)
    expect(dead).toEqual([])
  })
})
