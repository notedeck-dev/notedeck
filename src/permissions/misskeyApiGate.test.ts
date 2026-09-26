import { afterEach, describe, expect, it } from 'vitest'
import { assertMisskeyApiAllowed } from './misskeyApiGate'
import { _clearPluginDenialsForTest, getPluginDenial } from './pluginDenials'
import { setPermissionPreset } from './schema'
import { _resetPermissionsForTest, usePermissionsConfig } from './store'

function setPluginPreset(preset: 'readonly' | 'safe' | 'full'): void {
  const { file } = usePermissionsConfig()
  file.value.principals.plugin = setPermissionPreset(
    file.value.principals.plugin ?? { preset: 'readonly', custom: {} as never },
    preset,
  )
}

afterEach(() => {
  _resetPermissionsForTest()
  _clearPluginDenialsForTest()
})

describe('assertMisskeyApiAllowed (#712 §5.5)', () => {
  it('plugin=readonly では notes/create が拒否され、notes/show は通る', async () => {
    setPluginPreset('readonly')
    await expect(
      assertMisskeyApiAllowed(
        { kind: 'plugin', pluginId: 'p1' },
        'notes/create',
      ),
    ).rejects.toThrow(/permission_denied.*notes\.write/)
    await expect(
      assertMisskeyApiAllowed({ kind: 'plugin', pluginId: 'p1' }, 'notes/show'),
    ).resolves.toBeUndefined()
  })

  it('plugin 行で notes.write を許可すると notes/create が通る', async () => {
    setPluginPreset('full')
    await expect(
      assertMisskeyApiAllowed(
        { kind: 'plugin', pluginId: 'p1' },
        'notes/create',
      ),
    ).resolves.toBeUndefined()
  })

  it('対応表に無い endpoint は deny-by-default', async () => {
    setPluginPreset('full')
    await expect(
      assertMisskeyApiAllowed(
        { kind: 'plugin', pluginId: 'p1' },
        'some-fork/original-endpoint',
      ),
    ).rejects.toThrow(/unknown endpoint/)
  })

  it('admin 系 / 高感度 endpoint は full でも deny', async () => {
    setPluginPreset('full')
    await expect(
      assertMisskeyApiAllowed(
        { kind: 'plugin', pluginId: 'p1' },
        'admin/accounts/delete',
      ),
    ).rejects.toThrow(/is not open to/)
    await expect(
      assertMisskeyApiAllowed(
        { kind: 'plugin', pluginId: 'p1' },
        'i/regenerate-token',
      ),
    ).rejects.toThrow(/is not open to/)
  })

  it('ai.chat も自分のプロファイルで判定される (tasks.run 経由 #1099)', async () => {
    const { file } = usePermissionsConfig()
    file.value.principals['ai.chat'] = setPermissionPreset(
      file.value.principals['ai.chat'] ?? {
        preset: 'readonly',
        custom: {} as never,
      },
      'safe',
    )
    await expect(
      assertMisskeyApiAllowed({ kind: 'ai.chat' }, 'notes/create', {
        source: 'tasks.run',
      }),
    ).rejects.toThrow(/^tasks\.run: permission_denied.*notes\.write/)
    await expect(
      assertMisskeyApiAllowed({ kind: 'ai.chat' }, 'notes/show', {
        source: 'tasks.run',
      }),
    ).resolves.toBeUndefined()
    // AI の拒否はプラグインバッジには乗らない
    expect(getPluginDenial('p1')).toBeNull()
  })

  it('onBehalfOf の principal も AND で検査される (#1099)', async () => {
    setPluginPreset('full')
    const { file } = usePermissionsConfig()
    file.value.principals['ai.chat'] = setPermissionPreset(
      file.value.principals['ai.chat'] ?? {
        preset: 'readonly',
        custom: {} as never,
      },
      'readonly',
    )
    const plugin = { kind: 'plugin', pluginId: 'p1' } as const
    await expect(
      assertMisskeyApiAllowed(plugin, 'notes/create', {
        onBehalfOf: [{ kind: 'ai.chat' }],
      }),
    ).rejects.toThrow(/ai\.chat profile/)
    // user の呼び出し元は制限にならない
    await expect(
      assertMisskeyApiAllowed(plugin, 'notes/create', {
        onBehalfOf: [{ kind: 'user' }],
      }),
    ).resolves.toBeUndefined()
    // user の実行体でも AI の呼び出し元があれば検査される
    await expect(
      assertMisskeyApiAllowed({ kind: 'user' }, 'notes/create', {
        onBehalfOf: [{ kind: 'ai.chat' }],
      }),
    ).rejects.toThrow(/permission_denied/)
  })

  it('user (playground) は gate 免除', async () => {
    setPluginPreset('readonly')
    await expect(
      assertMisskeyApiAllowed({ kind: 'user' }, 'notes/create'),
    ).resolves.toBeUndefined()
    await expect(
      assertMisskeyApiAllowed({ kind: 'user' }, 'admin/accounts/delete'),
    ).resolves.toBeUndefined()
  })

  it('拒否は pluginDenials に記録される (#712 §8.4)', async () => {
    setPluginPreset('readonly')
    await expect(
      assertMisskeyApiAllowed(
        { kind: 'plugin', pluginId: 'badge-plugin' },
        'notes/create',
      ),
    ).rejects.toThrow()
    const entry = getPluginDenial('badge-plugin')
    expect(entry?.lastTarget).toBe('Mk:api notes/create')
    expect(entry?.lastKeys).toEqual(['notes.write'])
  })
})
