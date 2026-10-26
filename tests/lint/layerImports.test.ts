// 「層の依存方向」を機械検査に落とす (#1098)。
//
// DEVELOPMENT.md「層の依存方向」が定める向きは
//   components → composables → stores → services → adapters → bindings
// で、services は「純ロジックを store に書かず直接ユニットテストする」層 (#782)、
// adapters はフォーク差異を吸収する層。ところがこの向きは文書にしか無く、
// biome の import 制限もアーキテクチャテストも無かったため、監査時点で
//   - services が store や toast を runtime import する
//   - stores が composables を、adapters が stores を import する (向きの逆転)
//   - components が bindings / tauriInvoke / adapters/factory を直接叩く
// が積み上がっていた。設計が悪いのではなく、適用率を測る手段が無かった。
//
// 方針はラチェット。既存の違反は ALLOWED に理由つきで凍結し、新しい違反は
// 落とす。ALLOWED の項目が直ったら消す (消し忘れは下の「実在する違反だけを
// 挙げる」で落ちる)。`import type` は依存ではないので数えない。
//
// components の直接 IPC (監査時点 73 件) は #1258 で composable / adapter 経由に
// 寄せ切った。Misskey API は adapter (useColumnSetup / useMultiAccountAdapters)、
// ローカルの command は用途別の小さな composable を通す。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

interface Rule {
  /** 検査対象ディレクトリ (src 相対) */
  from: string
  /** 禁止する import 先 (指定子の前方一致) */
  forbid: string[]
  /** 凍結した既存違反: "src 相対パス" → 理由 */
  allowed: Record<string, string>
}

const RULES: Record<string, Rule> = {
  'services は stores / composables / components / UI 通知 / vue / pinia を runtime import しない':
    {
      from: 'src/services',
      forbid: [
        '@/stores/',
        '@/composables/',
        '@/components/',
        '@/utils/toastNotify',
        'vue',
        'pinia',
      ],
      allowed: {},
    },
  'deck のカラムは共通基盤 (useColumnSetup) を通り、その内部 (useColumnTheme / useServerImages) を直接 import しない (#1098 §4)':
    {
      from: 'src/components/deck',
      forbid: ['@/composables/useColumnTheme', '@/composables/useServerImages'],
      allowed: {
        'src/components/deck/DeckColumn.vue':
          'カラムの枠そのもの。requireAccount の「見つかりません」画像を引く',
      },
    },
  'stores は components を import しない': {
    from: 'src/stores',
    forbid: ['@/components/'],
    allowed: {},
  },
  'stores は composables を import しない (向きの逆転)': {
    from: 'src/stores',
    forbid: ['@/composables/'],
    allowed: {},
  },
  'adapters は stores を import しない (向きの逆転)': {
    from: 'src/adapters',
    forbid: ['@/stores/'],
    allowed: {},
  },
  'columns のレジストリは components を import しない': {
    from: 'src/columns',
    forbid: ['@/components/'],
    allowed: {},
  },
  'windows のレジストリは components を import しない': {
    from: 'src/windows',
    forbid: ['@/components/'],
    allowed: {},
  },
  'capabilities は components を import しない': {
    from: 'src/capabilities',
    forbid: ['@/components/'],
    allowed: {},
  },
  'components は IPC / adapter factory を直接叩かない': {
    from: 'src/components',
    forbid: [
      '@/bindings',
      '@/utils/tauriInvoke',
      '@/adapters/factory',
      '@tauri-apps/api/core',
    ],
    allowed: {},
  },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
      out.push(path)
  }
  return out
}

/** runtime 依存になる import 指定子を列挙する (`import type` と全指定子 `type` は除外)。 */
function runtimeImports(src: string): string[] {
  const out: string[] = []
  const stmt = /^(?:import|export)\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm
  for (const m of src.matchAll(stmt)) {
    const clause = m[1].trim()
    if (clause.startsWith('type ')) continue
    const braces = clause.match(/^\{([\s\S]*)\}$/)
    if (braces) {
      const names = braces[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (names.length > 0 && names.every((n) => n.startsWith('type ')))
        continue
    }
    out.push(m[2])
  }
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g))
    out.push(m[1])
  return out
}

function violations(rule: Rule): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of sourceFiles(join(ROOT, rule.from))) {
    const hits = runtimeImports(readFileSync(file, 'utf-8')).filter((spec) =>
      rule.forbid.some((f) => spec === f || spec.startsWith(f)),
    )
    if (hits.length > 0) found.set(relative(ROOT, file), [...new Set(hits)])
  }
  return found
}

describe('層の依存方向', () => {
  for (const [name, rule] of Object.entries(RULES)) {
    describe(name, () => {
      const found = violations(rule)

      it('ALLOWED に無い違反が無い', () => {
        const fresh = [...found]
          .filter(([rel]) => !(rel in rule.allowed))
          .map(([rel, specs]) => `${rel} → ${specs.join(', ')}`)
        expect(fresh).toEqual([])
      })

      it('ALLOWED は実在する違反だけを挙げる (直したら消す)', () => {
        const stale = Object.keys(rule.allowed).filter((rel) => !found.has(rel))
        expect(stale).toEqual([])
      })
    })
  }
})
