import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSON5 from 'json5'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: false,
  isMainDeckWindow: () => true,
  PROFILE_EXT: '.ndprofile.json5',
  THEME_EXT: '.ndtheme.json5',
  SKILL_EXT: '.md',
}))

import { sidecarMetaText } from '@/services/distributableCodecs/sidecar'
import { parseSkillFile, serializeSkillFile } from '@/services/skillFrontmatter'
import { _internal as queryInternal } from '@/stores/columnQueries'
import { _internal as pluginInternal } from '@/stores/plugins'
import { _internal as skillInternal } from '@/stores/skills'
import {
  themeFromFile,
  _internal as themeInternal,
} from '@/stores/themeFileSync'
import { _internal as widgetInternal } from '@/stores/widgets'

/**
 * 今の store の serialize (fromFile → toFileMeta) が codec の出力と一致する
 * ことを固定する (#1202 段階 0)。段階 1 で store が codec に置き換わるとき、
 * ファイルが 1 バイトも変わらないことの保証。入力と期待値は golden
 * (`golden/vectors.json`) を共有する。欠損した時刻は store が `Date.now()` で
 * 埋めるので、vector の `now` を system time にして揃える
 */

interface SidecarVector {
  name: string
  filename: string
  now: number
  meta: string
  src: string
  expected: string
}

interface SingleVector {
  name: string
  filename: string
  now: number
  text: string
  expected: string
}

const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'golden', 'vectors.json'), 'utf8'),
) as {
  plugin: SidecarVector[]
  widget: SidecarVector[]
  query: SidecarVector[]
  skill: SingleVector[]
  theme: SingleVector[]
}

const isValidId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 256

afterEach(() => {
  vi.useRealTimers()
})

function withNow<T>(now: number, fn: () => T): T {
  vi.useFakeTimers({ now })
  try {
    return fn()
  } finally {
    vi.useRealTimers()
  }
}

describe('store の serialize = codec の出力 (golden を共有)', () => {
  const sidecars = [
    ['plugin', pluginInternal],
    ['widget', widgetInternal],
    ['query', queryInternal],
  ] as const
  for (const [kind, internal] of sidecars) {
    describe(kind, () => {
      for (const v of vectors[kind]) {
        it(v.name, () => {
          const text = withNow(v.now, () => {
            // biome-ignore lint/suspicious/noExplicitAny: kind ごとの FileMeta 型を 1 本のループで回す
            const meta = JSON5.parse(v.meta) as any
            const item = internal.fromFile(meta, v.src, v.filename)
            return sidecarMetaText(internal.toFileMeta(item as never))
          })
          expect(text).toBe(v.expected)
        })
      }
    })
  }

  describe('theme', () => {
    for (const v of vectors.theme) {
      it(v.name, () => {
        const parsed = JSON5.parse(v.text) as Record<string, unknown>
        // 単一ファイルコレクションの ID 凍結の実効値と同じ
        const id = isValidId(parsed.id) ? parsed.id : `custom-${v.filename}`
        const theme = themeFromFile(parsed, id, v.filename, v.now)
        expect(themeInternal.serializeTheme(theme)).toBe(v.expected)
      })
    }
  })

  describe('skill', () => {
    for (const v of vectors.skill) {
      it(v.name, () => {
        const text = withNow(v.now, () => {
          const p = parseSkillFile(v.text)
          const base = v.filename.replace(/\.md$/, '')
          const id = isValidId(p.meta.id) ? p.meta.id : base
          const meta = skillInternal.metaFromFrontmatter(
            { ...p.meta, id },
            p.body,
            base,
          )
          return serializeSkillFile(
            skillInternal.frontmatterFromMeta(meta) as Record<
              string,
              string | number | boolean | string[]
            >,
            meta.body,
          )
        })
        expect(text).toBe(v.expected)
      })
    }
  })
})
