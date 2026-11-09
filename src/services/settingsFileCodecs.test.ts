// 設定ファイルの書込は決定的 (#1333 §2): 「読む → 書く → 読む → 書く」の 2 回目の
// 出力が 1 回目と byte 一致する。設定ファイルは Git / dotfiles マネージャで管理できる
// ものなので、読んだだけ・同じ内容を書いただけで差分が出てはいけない。
//
// 新しいルート設定ファイルは `CODECS` への登録が必須。allowlist
// (`crates/notecore/src/settings_store.rs` の ROOT_FILES) にあって登録も除外理由も
// 無いファイルがあると落ちる。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAiConfigText, serializeAiConfig } from '@/composables/useAiConfig'
import defaultAiJson5 from '@/defaults/ai.json5?raw'
import defaultKeybindsJson5 from '@/defaults/keybindings.json5?raw'
import defaultNavbarJson5 from '@/defaults/navbar.json5?raw'
import defaultPerformanceJson5 from '@/defaults/performance.json5?raw'
import defaultPostFormJson5 from '@/defaults/postform.json5?raw'
import defaultTasksJson5 from '@/defaults/tasks.json5?raw'
import {
  parsePermissionsMeta,
  serializePermissionsFile,
  serializePermissionsMeta,
} from '@/permissions/meta'
import { parsePermissionsFile } from '@/permissions/store'
import {
  parseClientConfig,
  serializeClientConfig,
} from '@/services/clientConfig'
import { parseJson5Document, stringifyJson5 } from '@/services/json5Document'
import {
  parseLocaleSetting,
  serializeLocaleSetting,
} from '@/services/localeSetting'
import {
  parseDropInRecord,
  serializeDropInRecord,
} from '@/services/themeDropIn'
import {
  parseTutorialProgress,
  serializeTutorialProgress,
} from '@/services/tutorialProgress'
import { parseUiState, serializeUiState } from '@/services/uiState'
import { parseSettingsText, serializeSettings } from '@/settings/schema'
import { parseTasks, serializeTasks } from '@/tasks/schema'

const ROOT = resolve(import.meta.dirname, '../..')

interface Codec {
  parse(text: string): unknown
  serialize(value: unknown): string
  /** 実際にありそうな本文 (既定値、順序を入れ替えたもの、コメント付き) */
  samples: string[]
}

const json5 = (empty: () => unknown, samples: string[]): Codec => ({
  parse: (t) => parseJson5Document(t, empty),
  serialize: stringifyJson5,
  samples,
})

/** ルートファイル名 → コーデック。allowlist に載せたら必ずここにも足す */
const CODECS: Record<string, Codec> = {
  'settings.json5': {
    parse: (t) => parseSettingsText(t),
    serialize: (v) => serializeSettings(v as never),
    samples: [
      '',
      "{ theme: 'dark', _schema: 1 }\n",
      // 未知キーと順序の違い、分離済みキー (ai / keybinds) の剥がし
      "// comment\n{\n  'unknown.key': 1,\n  theme: 'light',\n  ai: { x: 1 },\n  keybinds: {},\n}\n",
    ],
  },
  'keybinds.json5': json5(
    () => ({}),
    ['', defaultKeybindsJson5, "{ 'note.create': [{ key: 'n' }], 'z': [] }"],
  ),
  'navbar.json5': json5(() => [], ['', defaultNavbarJson5]),
  'postform.json5': json5(() => [], ['', defaultPostFormJson5]),
  'performance.json5': json5(
    () => ({}),
    ['', defaultPerformanceJson5, '{ noteStoreMax: 100, cssBlurLevel: 0 }'],
  ),
  'tasks.json5': {
    parse: parseTasks,
    serialize: (v) => serializeTasks(v as never),
    samples: ['', defaultTasksJson5],
  },
  'ai.json5': {
    parse: parseAiConfigText,
    serialize: (v) => serializeAiConfig(v as never),
    samples: [
      '',
      defaultAiJson5,
      "{ heartbeat: { enabled: true, intervalMinutes: 5 }, activeConnectionId: 'c', models: { c: 'm' } }",
    ],
  },
  'permissions.json5': {
    parse: (t) => parsePermissionsFile(t).file,
    serialize: (v) => serializePermissionsFile(v as never),
    samples: [
      '{}',
      "{ schemaVersion: 1, principals: { 'ai.chat': { preset: 'readonly' } }, confirmSkips: { 'ai.chat': ['notes.create'] } }",
    ],
  },
  'permissions-meta.json5': {
    parse: parsePermissionsMeta,
    serialize: (v) => serializePermissionsMeta(v as never),
    samples: [
      '',
      "{ confirmSkips: { 'ai.chat': ['notes.create'], 'plugin:x': ['a.b', 'a.b'] }, granted: { external: ['notes.read'], plugin: [] } }",
    ],
  },
  'tutorial.json5': {
    parse: parseTutorialProgress,
    serialize: (v) => serializeTutorialProgress(v as never),
    samples: [
      '',
      '{ version: 1, items: { a: 1 }, achievements: {}, resetAt: 5 }',
    ],
  },
  'theme-dropins.json5': {
    parse: parseDropInRecord,
    serialize: (v) => serializeDropInRecord(v as never),
    samples: ['', "{ adopted: { 'Foo.json5': 'custom-foo' } }"],
  },
  'locale.json5': {
    parse: (t) => parseLocaleSetting(t) ?? { locale: 'auto' },
    serialize: (v) => serializeLocaleSetting(v as never),
    samples: [
      "{ locale: 'ja-JP' }",
      "{ locale: 'en-US', migrated: true }",
      '{}',
    ],
  },
  'client.json5': {
    parse: parseClientConfig,
    serialize: (v) => serializeClientConfig(v as never),
    samples: ['', "{ backend: 'resident' }"],
  },
  'ui.json5': {
    parse: parseUiState,
    serialize: (v) => serializeUiState(v as never),
    samples: [
      '',
      "{ 'pet.bottom': 40, 'ui.zoom': 1.25, 'postForm.lastUsedVisibilityByAccount': { a: 'home' }, unknown: 1 }",
    ],
  },
}

/** コーデックを持たないルートファイルと、その理由 */
const NOT_A_CODEC: Record<string, string> = {
  'AI.md': 'アプリは書かない (利用者が置く自由記述)',
  'custom.css': '自由記述のテキスト。読んだまま書く',
  'connections.json': 'Rust (vault::connections_store) が厳密 JSON で書く',
}

function rootFilesInAllowlist(): string[] {
  const src = readFileSync(
    resolve(ROOT, 'crates/notecore/src/settings_store.rs'),
    'utf-8',
  )
  const body = src.match(/pub const ROOT_FILES[^=]*=\s*&\[([\s\S]*?)\n\];/)?.[1]
  if (!body) throw new Error('ROOT_FILES not found in settings_store.rs')
  const names: string[] = []
  for (const m of body.matchAll(
    /root\("([^"]+)"\)|name:\s*(?:"([^"]+)"|CONNECTIONS_FILE)/g,
  )) {
    names.push(m[1] ?? m[2] ?? 'connections.json')
  }
  return names
}

describe('設定ファイルの書込は決定的 (#1333 §2)', () => {
  it('allowlist のルートファイルは全部、コーデックか除外理由を持つ', () => {
    const names = rootFilesInAllowlist()
    expect(names.length).toBeGreaterThan(10)
    const missing = names.filter((n) => !(n in CODECS) && !(n in NOT_A_CODEC))
    expect(missing).toEqual([])
    const stale = [...Object.keys(CODECS), ...Object.keys(NOT_A_CODEC)].filter(
      (n) => !names.includes(n),
    )
    expect(stale).toEqual([])
  })

  for (const [name, codec] of Object.entries(CODECS)) {
    it(`${name}: 読んで書いた結果を読んで書いても変わらない`, () => {
      for (const sample of codec.samples) {
        const first = codec.serialize(codec.parse(sample))
        const second = codec.serialize(codec.parse(first))
        expect(second, `sample: ${JSON.stringify(sample.slice(0, 60))}`).toBe(
          first,
        )
        expect(first.endsWith('\n')).toBe(true)
      }
    })
  }

  it('標準の整形は 2 スペース・末尾改行・挿入順', () => {
    expect(stringifyJson5({ b: 1, a: [1, 2] })).toBe(
      '{\n  b: 1,\n  a: [\n    1,\n    2,\n  ],\n}\n',
    )
  })
})
