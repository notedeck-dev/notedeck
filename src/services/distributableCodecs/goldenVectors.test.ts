import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  DistributableCodec,
  DistributableMeta,
} from '@/services/distributable'
import { pluginCodec } from '@/services/distributableCodecs/pluginCodec'
import { queryCodec } from '@/services/distributableCodecs/queryCodec'
import { skillCodec } from '@/services/distributableCodecs/skillCodec'
import { themeCodec } from '@/services/distributableCodecs/themeCodec'
import { widgetCodec } from '@/services/distributableCodecs/widgetCodec'

/**
 * TS / Rust の codec が同じファイルを書くことを固定する golden (#1202 段階 0)。
 *
 * 期待値の正本は TS 側で、`pnpm gen:golden-distributables` が `expected` を
 * 採り直す (入力は手書き)。Rust は同じファイルを `include_str!` で読んで
 * 同じ入力から同じ `expected` を出すことを検査する
 * (`crates/notecore/src/sidecar/golden.rs` / `crates/notemaid/src/skills.rs`)。
 *
 * 入力に書かないもの (両書き手で揺れることが分かっている差):
 * - 未知のキー (Rust は末尾に残し、TS は落とす)
 * - widget の旧 `accountId` だけの個体 (Rust は残し、TS は移行して落とす)
 * - テーマの props の数値 (Rust は文字列化し、TS はそのまま)
 */

const VECTORS_PATH = resolve(import.meta.dirname, 'golden', 'vectors.json')
const UPDATE = process.env.UPDATE_GOLDEN_DISTRIBUTABLES === '1'

interface SidecarVector {
  name: string
  /** メタファイルの完全名 (ID 欠損時の実効値) */
  filename: string
  /** 欠損した時刻の埋め草 */
  now: number
  /** 入力メタ (JSON5 テキスト) */
  meta: string
  src: string
  /** `toFile(fromFile(入力))` のメタファイル本文 */
  expected: string
}

interface SingleVector {
  name: string
  filename: string
  now: number
  /** 入力ファイルの本文 */
  text: string
  /** `toFile(fromFile(入力))` のファイル本文 */
  expected: string
}

interface Vectors {
  plugin: SidecarVector[]
  widget: SidecarVector[]
  query: SidecarVector[]
  skill: SingleVector[]
  theme: SingleVector[]
}

function load(): Vectors {
  return JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as Vectors
}

function roundTrip<File, Item extends DistributableMeta<unknown, unknown>>(
  codec: DistributableCodec<File, Item>,
  text: string,
  src: string,
  filename: string,
  now: number,
): string {
  const item = codec.fromFile(codec.decode(text, src), { filename, now })
  return codec.encode(codec.toFile(item))
}

type RoundTrip = (
  text: string,
  src: string,
  filename: string,
  now: number,
) => string

describe('distributable codecs golden (TS = 正本、Rust が追随)', () => {
  const vectors = load()
  const sidecars: [
    keyof Pick<Vectors, 'plugin' | 'widget' | 'query'>,
    RoundTrip,
  ][] = [
    ['plugin', (...a) => roundTrip(pluginCodec, ...a)],
    ['widget', (...a) => roundTrip(widgetCodec, ...a)],
    ['query', (...a) => roundTrip(queryCodec, ...a)],
  ]
  const singles: [keyof Pick<Vectors, 'skill' | 'theme'>, RoundTrip][] = [
    ['skill', (...a) => roundTrip(skillCodec, ...a)],
    ['theme', (...a) => roundTrip(themeCodec, ...a)],
  ]

  if (UPDATE) {
    it('expected を採り直す', () => {
      for (const [kind, run] of sidecars) {
        for (const v of vectors[kind]) {
          v.expected = run(v.meta, v.src, v.filename, v.now)
        }
      }
      for (const [kind, run] of singles) {
        for (const v of vectors[kind]) {
          v.expected = run(v.text, '', v.filename, v.now)
        }
      }
      writeFileSync(VECTORS_PATH, `${JSON.stringify(vectors, null, 2)}\n`)
    })
    return
  }

  for (const [kind, run] of sidecars) {
    describe(kind, () => {
      for (const v of vectors[kind]) {
        it(v.name, () => {
          expect(run(v.meta, v.src, v.filename, v.now)).toBe(v.expected)
          // 固定 projection: 書いたものを読み直して書いても変わらない
          expect(run(v.expected, v.src, v.filename, 0)).toBe(v.expected)
        })
      }
    })
  }
  for (const [kind, run] of singles) {
    describe(kind, () => {
      for (const v of vectors[kind]) {
        it(v.name, () => {
          expect(run(v.text, '', v.filename, v.now)).toBe(v.expected)
          expect(run(v.expected, '', v.filename, 0)).toBe(v.expected)
        })
      }
    })
  }
})
