// 実行時の循環 import を機械検査に落とす (#1098 §6)。
//
// 数えるのは「実行時の静的 import」だけ。`import type` と `import()` (非同期) は
// 読込時の輪にならないので辺にしない — MkNote ↔ MkPostForm のように
// defineAsyncComponent で切ってある関係は循環ではない (2026-10-08 の判断)。
//
// 方針はラチェット。監査時点で残っていた強連結成分 (SCC) は理由つきで凍結し、
// 新しい輪は落とす。凍結分が解けたら ALLOWED から消す (消し忘れは落ちる)。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

/** 凍結した SCC: ソート済みのメンバー一覧を '|' で繋いだ鍵 → 理由 */
const ALLOWED: Record<string, string> = {
  'src/services/entityResolution.ts|src/stores/accounts.ts':
    '凍結 (#1098): entityResolution が accounts store を直接引く (層依存 lint でも凍結)。アカウント一覧は引数で受けるべき',
  'src/stores/offlineMode.ts|src/stores/realtimeMode.ts':
    '凍結 (#1098): オフラインとリアルタイムの相互参照。片方の状態を引数で渡すか、両方を 1 つの接続状態 store に畳むべき',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(name) && !/\.(test|spec)\.ts$/.test(name))
      out.push(p)
  }
  return out
}

/** 静的 import の指定子を拾う (`import type` と `import()` は除く)。 */
function staticSpecifiers(source: string): string[] {
  const out: string[] = []
  const re =
    /^\s*(?:import\s+(?!type\s)[^'"]*?from\s*|import\s*|export\s+(?!type\s)[^'"]*?from\s*)['"]([^'"]+)['"]/gm
  for (const m of source.matchAll(re)) {
    const spec = m[1] as string
    out.push(spec)
  }
  return out
}

function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  const candidates = [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** Tarjan の SCC。サイズ 2 以上の成分だけ返す。 */
function stronglyConnected(graph: Map<string, Set<string>>): string[][] {
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const result: string[][] = []
  const visit = (v: string) => {
    idx.set(v, index)
    low.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(w) as number))
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = []
      let w: string
      do {
        w = stack.pop() as string
        onStack.delete(w)
        comp.push(w)
      } while (w !== v)
      if (comp.length > 1) result.push(comp.sort())
    }
  }
  for (const v of graph.keys()) if (!idx.has(v)) visit(v)
  return result
}

function buildGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file)
    const edges = new Set<string>()
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      const target = resolveSpec(file, spec)
      if (target && target !== file) edges.add(relative(ROOT, target))
    }
    graph.set(rel, edges)
  }
  return graph
}

describe('実行時の循環 import (#1098 §6)', () => {
  const sccs = stronglyConnected(buildGraph())
  const keys = new Set(sccs.map((c) => c.join('|')))

  it('凍結した輪以外の強連結成分は無い', () => {
    const unexpected = sccs.filter((c) => !(c.join('|') in ALLOWED))
    expect(
      unexpected,
      `新しい実行時の循環 import。輪を切るか、理由つきで ALLOWED に凍結する:\n${unexpected
        .map((c) => `  - ${c.join(' ↔ ')}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('ALLOWED は実在する輪だけを挙げる (直したら消す)', () => {
    const stale = Object.keys(ALLOWED).filter((k) => !keys.has(k))
    expect(stale, '解けた輪が ALLOWED に残っている').toEqual([])
  })
})
