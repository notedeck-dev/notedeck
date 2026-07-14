import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_READ_FLOOR,
  PERMISSION_KEYS,
  type PermissionsConfig,
  resolvePermissions,
  THIRD_PARTY_DENY_KEYS,
} from './schema'
import {
  _resetPermissionsForTest,
  addConfirmSkip,
  confirmSkipScope,
  isConfirmSkipped,
  migrateLegacyPermissions,
  normalizePermissionsFile,
  removeConfirmSkip,
  resolveForProfiled,
  usePermissionsConfig,
} from './store'

function customOf(
  preset: 'readonly' | 'safe' | 'full',
): PermissionsConfig['custom'] {
  return resolvePermissions({
    preset,
    custom: {} as PermissionsConfig['custom'],
  })
}

/** 旧 33 キー時代の custom map (deck.read 欠損) を再現する。 */
function legacyCustom(
  preset: 'readonly' | 'safe' | 'full',
  overrides: Partial<Record<string, boolean>> = {},
): PermissionsConfig['custom'] {
  const map = { ...customOf(preset), ...overrides } as Record<string, boolean>
  delete map['deck.read']
  return map as PermissionsConfig['custom']
}

describe('migrateLegacyPermissions (#712 §4.4)', () => {
  it('ai.chat は旧 permissions をそのまま引き継ぐ', () => {
    const file = migrateLegacyPermissions({
      permissions: { preset: 'safe', custom: {} as never },
    })
    expect(file.principals['ai.chat']?.preset).toBe('safe')
  })

  it('plugin は chat の複製で初期化される', () => {
    const file = migrateLegacyPermissions({
      permissions: { preset: 'safe', custom: {} as never },
    })
    expect(file.principals.plugin?.preset).toBe('safe')
    expect(file.principals.plugin?.custom).toEqual(
      file.principals['ai.chat']?.custom,
    )
  })

  it('heartbeat は AND 初期化: chat=safe / hb=full → write は移行後も拒否 (権限拡大しない)', () => {
    const file = migrateLegacyPermissions({
      permissions: { preset: 'safe', custom: {} as never },
      heartbeat: { permissions: { preset: 'full', custom: {} as never } },
    })
    const hb = file.principals['ai.heartbeat']
    expect(hb).toBeDefined()
    const resolved = resolvePermissions(hb as PermissionsConfig)
    // safe ∩ full = safe (notes.write は false のまま)
    expect(resolved['notes.write']).toBe(false)
    expect(resolved['notes.react']).toBe(true)
    // 一致する preset には正規化される (custom の無情報 chip を出さない)
    expect(hb?.preset).toBe('safe')
  })

  it('heartbeat AND: chat=full / hb=readonly → readonly 相当に絞られる', () => {
    const file = migrateLegacyPermissions({
      permissions: { preset: 'full', custom: {} as never },
      heartbeat: { permissions: { preset: 'readonly', custom: {} as never } },
    })
    const resolved = resolvePermissions(
      file.principals['ai.heartbeat'] as PermissionsConfig,
    )
    expect(resolved['notes.write']).toBe(false)
    expect(resolved['notes.read']).toBe(true)
  })

  it('external: httpApi=readonly → ローカル read を落とした縮小 custom (memos.read=false / notes.read=true)', () => {
    const file = migrateLegacyPermissions({
      httpApi: { permissions: { preset: 'readonly', custom: {} as never } },
    })
    const ext = file.principals.external
    expect(ext?.preset).toBe('custom')
    expect(ext?.custom['memos.read']).toBe(false)
    expect(ext?.custom['drafts.read']).toBe(false)
    expect(ext?.custom['ai.sessions.read']).toBe(false)
    expect(ext?.custom['deck.read']).toBe(false)
    expect(ext?.custom['notes.read']).toBe(true)
    expect(ext?.custom['account.read']).toBe(true)
  })

  it('external: httpApi=full はそのまま保存 (全部への明示同意)', () => {
    const file = migrateLegacyPermissions({
      httpApi: { permissions: { preset: 'full', custom: {} as never } },
    })
    expect(file.principals.external?.preset).toBe('full')
  })

  it('external: httpApi=custom は保存値を尊重しつつ deck.read=false を backfill', () => {
    const file = migrateLegacyPermissions({
      httpApi: {
        permissions: {
          preset: 'custom',
          custom: legacyCustom('readonly', { 'memos.read': true }),
        },
      },
    })
    const ext = file.principals.external
    expect(ext?.preset).toBe('custom')
    // ユーザーの個別編集 (memos.read=true) は明示同意として尊重
    expect(ext?.custom['memos.read']).toBe(true)
    // 新キーは external では false で補完 (第 5 の穴を閉じる)
    expect(ext?.custom['deck.read']).toBe(false)
  })

  it('chat=custom (旧 33 キー保存) → deck.read=true が backfill され column 系が全滅しない', () => {
    const file = migrateLegacyPermissions({
      permissions: { preset: 'custom', custom: legacyCustom('safe') },
    })
    expect(file.principals['ai.chat']?.custom['deck.read']).toBe(true)
    // heartbeat AND のソースが custom でも deck.read が欠損しない
    expect(
      resolvePermissions(file.principals['ai.heartbeat'] as PermissionsConfig)[
        'deck.read'
      ],
    ).toBe(true)
  })

  it('旧フィールドが無い ai.json5 → 旧実効挙動を保存 (readonly / external は縮小 custom)', () => {
    const file = migrateLegacyPermissions({})
    expect(file.principals['ai.chat']?.preset).toBe('readonly')
    expect(file.principals.external?.custom['memos.read']).toBe(false)
  })
})

describe('normalizePermissionsFile', () => {
  it('欠けている principal はデフォルトで補完される', () => {
    const file = normalizePermissionsFile({
      schemaVersion: 1,
      principals: {
        'ai.chat': { preset: 'full', custom: {} as never },
      },
    })
    expect(file.principals['ai.chat']?.preset).toBe('full')
    expect(file.principals['ai.heartbeat']?.preset).toBe('readonly')
    expect(file.principals.external?.preset).toBe('custom')
  })

  it('未知キー (将来の plugin:<id>) は保持される', () => {
    const file = normalizePermissionsFile({
      schemaVersion: 1,
      principals: {
        'plugin:com.example.foo': { preset: 'safe', custom: {} as never },
      },
    })
    expect(file.principals['plugin:com.example.foo']?.preset).toBe('safe')
  })

  it('custom map の全キーが PERMISSION_KEYS で埋まる (正規化)', () => {
    const file = normalizePermissionsFile({
      schemaVersion: 1,
      principals: {
        'ai.chat': {
          preset: 'custom',
          custom: { 'notes.read': true } as never,
        },
      },
    })
    const custom = file.principals['ai.chat']?.custom as Record<string, boolean>
    for (const key of PERMISSION_KEYS) {
      expect(typeof custom[key], key).toBe('boolean')
    }
  })

  it('null / 空 → 完全なデフォルト (chat=safe, plugin=safe+外部ネットワーク, heartbeat=readonly)', () => {
    const file = normalizePermissionsFile(null)
    expect(file.principals['ai.chat']?.preset).toBe('safe')
    // plugin は safe + network.external (#714 followup): 外部 API 連携
    // ウィジェットが初期状態で動く。http.fetch の都度確認は残る
    expect(file.principals.plugin?.preset).toBe('custom')
    expect(file.principals.plugin?.custom['network.external']).toBe(true)
    expect(file.principals.plugin?.custom['notes.write']).toBe(false)
    expect(file.principals['ai.heartbeat']?.preset).toBe('readonly')
    expect(file.principals.external?.custom['deck.read']).toBe(false)
  })
})

describe('confirmSkips —「今後確認しない」の記憶 (#714)', () => {
  it('normalizePermissionsFile は有効な scope のみ保持し、重複と不正値を落とす', () => {
    const file = normalizePermissionsFile({
      schemaVersion: 1,
      principals: {},
      confirmSkips: {
        'ai.chat': ['clips.create', 'clips.create', 42 as never],
        'plugin:widget:clock': ['notes.create'],
        // 無人実行 (heartbeat) と external は「今後確認しない」の対象外
        'ai.heartbeat': ['notes.create'],
        external: ['notes.create'],
        bogus: ['notes.create'],
      },
    })
    expect(file.confirmSkips['ai.chat']).toEqual(['clips.create'])
    expect(file.confirmSkips['plugin:widget:clock']).toEqual(['notes.create'])
    expect(file.confirmSkips['ai.heartbeat']).toBeUndefined()
    expect(file.confirmSkips.external).toBeUndefined()
    expect(file.confirmSkips.bogus).toBeUndefined()
  })

  it('confirmSkips が無い旧ファイルは空で補完される', () => {
    const file = normalizePermissionsFile({ schemaVersion: 1, principals: {} })
    expect(file.confirmSkips).toEqual({})
  })

  it('confirmSkipScope: ai.chat と plugin (個体単位) のみスキップ可能', () => {
    expect(confirmSkipScope({ kind: 'ai.chat' })).toBe('ai.chat')
    expect(confirmSkipScope({ kind: 'plugin', pluginId: 'widget:clock' })).toBe(
      'plugin:widget:clock',
    )
    expect(confirmSkipScope({ kind: 'user' })).toBeNull()
    expect(confirmSkipScope({ kind: 'ai.heartbeat' })).toBeNull()
    expect(confirmSkipScope({ kind: 'external' })).toBeNull()
  })

  it('add / isSkipped / remove が一貫して動く', () => {
    usePermissionsConfig()
    expect(isConfirmSkipped('ai.chat', 'clips.create')).toBe(false)
    addConfirmSkip('ai.chat', 'clips.create')
    expect(isConfirmSkipped('ai.chat', 'clips.create')).toBe(true)
    // 別 scope には効かない
    expect(isConfirmSkipped('plugin:widget:clock', 'clips.create')).toBe(false)
    removeConfirmSkip('ai.chat', 'clips.create')
    expect(isConfirmSkipped('ai.chat', 'clips.create')).toBe(false)
    _resetPermissionsForTest()
  })
})

describe('resolveForProfiled — principal 別 clamp (#712 PR 1c)', () => {
  it('plugin / external は THIRD_PARTY_DENY_KEYS が full でも false に clamp される', () => {
    const { file } = usePermissionsConfig()
    file.value.principals.plugin = { preset: 'full', custom: {} as never }
    file.value.principals.external = { preset: 'full', custom: {} as never }
    for (const id of ['plugin', 'external'] as const) {
      const resolved = resolveForProfiled(id)
      for (const key of THIRD_PARTY_DENY_KEYS) {
        expect(resolved[key], `${id}:${key}`).toBe(false)
      }
    }
    _resetPermissionsForTest()
  })

  it('plugin の vault.use は clamp されない (#759 — 接続側の開示が gate)、external は Misskey read 4 キーが常時 true', () => {
    const { file } = usePermissionsConfig()
    file.value.principals.plugin = { preset: 'full', custom: {} as never }
    expect(resolveForProfiled('plugin')['vault.use']).toBe(true)

    const allOff = Object.fromEntries(
      PERMISSION_KEYS.map((k) => [k, false]),
    ) as never
    file.value.principals.external = { preset: 'custom', custom: allOff }
    const resolved = resolveForProfiled('external')
    for (const key of EXTERNAL_READ_FLOOR) {
      expect(resolved[key], key).toBe(true)
    }
    expect(resolved['memos.read']).toBe(false)
    _resetPermissionsForTest()
  })

  it('ai.chat / ai.heartbeat には floor を適用しない (自己拡張の非破壊)', () => {
    const { file } = usePermissionsConfig()
    file.value.principals['ai.chat'] = { preset: 'full', custom: {} as never }
    file.value.principals['ai.heartbeat'] = {
      preset: 'full',
      custom: {} as never,
    }
    expect(resolveForProfiled('ai.chat')['skills.write']).toBe(true)
    expect(resolveForProfiled('ai.chat')['tasks.run']).toBe(true)
    expect(resolveForProfiled('ai.heartbeat')['skills.write']).toBe(true)
    _resetPermissionsForTest()
  })
})
