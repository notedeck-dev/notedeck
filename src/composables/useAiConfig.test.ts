import { describe, expect, it } from 'vitest'
import {
  _internal,
  type AiConfig,
  DATA_SOURCE_KEYS,
  type DataSourcesConfig,
  defaultConfig,
  HEARTBEAT_INTERVAL_DEFAULT_MINUTES,
  HEARTBEAT_INTERVAL_MAX_MINUTES,
  HEARTBEAT_INTERVAL_MIN_MINUTES,
  type HeartbeatConfig,
  PERMISSION_KEYS,
  type PermissionsConfig,
  resolveDataSources,
  resolvePermissions,
  setDataSourcePreset,
  setPermissionPreset,
} from './useAiConfig'

const { mergeConfig } = _internal

describe('defaultConfig', () => {
  it('returns readonly preset for both permissions and dataSources', () => {
    const cfg = defaultConfig()
    expect(cfg.permissions.preset).toBe('readonly')
    expect(cfg.dataSources.preset).toBe('readonly')
  })

  it('default permissions allow only read operations', () => {
    const resolved = resolvePermissions(defaultConfig().permissions)
    expect(resolved['notes.read']).toBe(true)
    expect(resolved['account.read']).toBe(true)
    expect(resolved['drive.read']).toBe(true)
    expect(resolved['notes.write']).toBe(false)
    expect(resolved['account.write']).toBe(false)
    expect(resolved['network.external']).toBe(false)
  })

  it('default dataSources include account/column/memos but not visibleNotes/recentConversation', () => {
    const resolved = resolveDataSources(defaultConfig().dataSources)
    expect(resolved.currentAccount).toBe(true)
    expect(resolved.currentColumn).toBe(true)
    expect(resolved.visibleNotes).toBe(false)
    expect(resolved.recentConversation).toBe(false)
    expect(resolved.memos).toBe(true)
  })
})

describe('resolvePermissions / resolveDataSources', () => {
  it('safe preset enables react/clipboard/notifications but not write operations', () => {
    const resolved = resolvePermissions({
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    })
    expect(resolved['notes.react']).toBe(true)
    expect(resolved.clipboard).toBe(true)
    expect(resolved.notifications).toBe(true)
    expect(resolved['notes.write']).toBe(false)
    expect(resolved['network.external']).toBe(false)
  })

  it('full preset enables all permissions including network.external', () => {
    const resolved = resolvePermissions({
      preset: 'full',
      custom: {} as PermissionsConfig['custom'],
    })
    expect(resolved['notes.write']).toBe(true)
    expect(resolved['account.write']).toBe(true)
    expect(resolved['drive.write']).toBe(true)
    expect(resolved['network.external']).toBe(true)
  })

  it('custom preset returns the custom map verbatim', () => {
    const resolved = resolvePermissions({
      preset: 'custom',
      custom: {
        'notes.read': true,
        'notes.write': false,
        'notes.react': true,
        'account.read': true,
        'account.write': false,
        'drive.read': true,
        'drive.write': false,
        'memos.read': true,
        'memos.write': false,
        'clips.read': true,
        'clips.write': false,
        'drafts.read': true,
        'drafts.write': false,
        'network.external': true,
        clipboard: false,
        notifications: false,
        'tasks.run': false,
        'ai.invoke': true,
        'ai.persona.write': false,
        'skills.read': true,
        'skills.write': false,
        'theme.write': false,
        'styles.write': false,
        'navbar.write': false,
        'keybinds.write': false,
        'performance.write': false,
        'widgets.read': true,
        'widgets.write': false,
        'plugins.read': true,
        'plugins.write': false,
        'ai.sessions.read': true,
        'logs.read': true,
        'vault.use': false,
      },
    })
    expect(resolved['network.external']).toBe(true)
    expect(resolved['notes.react']).toBe(true)
    expect(resolved['account.write']).toBe(false)
  })
})

describe('setPermissionPreset / setDataSourcePreset', () => {
  it('switching from readonly to safe replaces custom with safe defaults', () => {
    const next = setPermissionPreset(defaultConfig().permissions, 'safe')
    expect(next.preset).toBe('safe')
    expect(next.custom['notes.react']).toBe(true)
    expect(next.custom.clipboard).toBe(true)
  })

  it('switching to custom pre-fills custom from the previously resolved preset', () => {
    // Start at 'safe' (resolved values), switch to 'custom'.
    const safe: PermissionsConfig = {
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    }
    const next = setPermissionPreset(safe, 'custom')
    expect(next.preset).toBe('custom')
    // Pre-filled with safe's resolved values
    expect(next.custom['notes.react']).toBe(true)
    expect(next.custom.clipboard).toBe(true)
    expect(next.custom['notes.write']).toBe(false)
  })

  it('switching dataSources to full enables visibleNotes and recentConversation', () => {
    const next = setDataSourcePreset(defaultConfig().dataSources, 'full')
    expect(next.preset).toBe('full')
    expect(next.custom.visibleNotes).toBe(true)
    expect(next.custom.recentConversation).toBe(true)
    expect(next.custom.memos).toBe(true)
  })

  it('safe preset enables memos (PKM 用 markdown はユーザー自身の note として送って良い)', () => {
    const next = setDataSourcePreset(defaultConfig().dataSources, 'safe')
    expect(next.preset).toBe('safe')
    expect(next.custom.memos).toBe(true)
  })
})

describe('preset key coverage', () => {
  // 将来 PERMISSION_KEYS に新キーを足したのに preset 定義に書き忘れた場合に
  // 検出するためのガードテスト。
  it.each([
    'readonly',
    'safe',
    'full',
  ] as const)('every PERMISSION_KEYS entry has a boolean in the %s preset', (preset) => {
    const resolved = resolvePermissions({
      preset,
      custom: {} as PermissionsConfig['custom'],
    })
    for (const key of PERMISSION_KEYS) {
      expect(typeof resolved[key], `permissions.${key} on ${preset}`).toBe(
        'boolean',
      )
    }
  })

  it.each([
    'readonly',
    'safe',
    'full',
  ] as const)('every DATA_SOURCE_KEYS entry has a boolean in the %s preset', (preset) => {
    const resolved = resolveDataSources({
      preset,
      custom: {} as DataSourcesConfig['custom'],
    })
    for (const key of DATA_SOURCE_KEYS) {
      expect(typeof resolved[key], `dataSources.${key} on ${preset}`).toBe(
        'boolean',
      )
    }
  })

  it('readonly preset is the strictest (no write / network / clipboard / notifications)', () => {
    const resolved = resolvePermissions({
      preset: 'readonly',
      custom: {} as PermissionsConfig['custom'],
    })
    for (const key of [
      'notes.write',
      'notes.react',
      'account.write',
      'drive.write',
      'clips.write',
      'drafts.write',
      'network.external',
      'clipboard',
      'notifications',
      'ai.invoke',
      'ai.persona.write',
      'skills.write',
      'theme.write',
      'styles.write',
      'navbar.write',
      'keybinds.write',
      'performance.write',
      'widgets.write',
      'plugins.write',
    ] as const) {
      expect(resolved[key], `${key} must be false on readonly`).toBe(false)
    }
  })

  it('full preset is the most permissive (all true)', () => {
    const resolved = resolvePermissions({
      preset: 'full',
      custom: {} as PermissionsConfig['custom'],
    })
    for (const key of PERMISSION_KEYS) {
      expect(resolved[key], `${key} must be true on full`).toBe(true)
    }
  })
})

describe('mergeConfig', () => {
  it('ai.json5 without permissions/dataSources is filled with defaults', () => {
    const partial: Partial<AiConfig> = {
      activeConnectionId: '01HXXXXXXXXXXXXXXXXXXXXXXX',
      models: { '01HXXXXXXXXXXXXXXXXXXXXXXX': 'gpt-test' },
    }
    const merged = mergeConfig(defaultConfig(), partial)
    expect(merged.activeConnectionId).toBe('01HXXXXXXXXXXXXXXXXXXXXXXX')
    expect(merged.models['01HXXXXXXXXXXXXXXXXXXXXXXX']).toBe('gpt-test')
    // Permissions/dataSources fall back to defaults (readonly preset)
    expect(merged.permissions.preset).toBe('readonly')
    expect(merged.dataSources.preset).toBe('readonly')
    expect(merged.permissions.custom['notes.read']).toBe(true)
  })

  it('partial permissions.custom values are deep-merged with defaults', () => {
    const partial: Partial<AiConfig> = {
      permissions: {
        preset: 'custom',
        custom: { 'notes.write': true } as PermissionsConfig['custom'],
      },
    }
    const merged = mergeConfig(defaultConfig(), partial)
    expect(merged.permissions.preset).toBe('custom')
    // Overridden key
    expect(merged.permissions.custom['notes.write']).toBe(true)
    // Default key preserved
    expect(merged.permissions.custom['notes.read']).toBe(true)
    expect(merged.permissions.custom['network.external']).toBe(false)
  })

  it('partial dataSources.preset only applies preset, custom defaults preserved', () => {
    const partial: Partial<AiConfig> = {
      dataSources: {
        preset: 'safe',
      } as Partial<DataSourcesConfig> as DataSourcesConfig,
    }
    const merged = mergeConfig(defaultConfig(), partial)
    expect(merged.dataSources.preset).toBe('safe')
    // custom is preserved from defaults (readonly's custom)
    expect(merged.dataSources.custom.currentAccount).toBe(true)
  })
})

describe('heartbeat config (#411 Phase 6)', () => {
  it('default has enabled=false, interval=30, target=auto, permissions=readonly + cheap-check defaults', () => {
    const cfg = defaultConfig()
    expect(cfg.heartbeat.enabled).toBe(false)
    expect(cfg.heartbeat.intervalMinutes).toBe(30)
    expect(cfg.heartbeat.target).toBe('auto')
    expect(cfg.heartbeat.permissions.preset).toBe('readonly')
    // Cheap Check First (#411) defaults
    expect(cfg.heartbeat.cheapCheck.enabled).toBe(true)
    expect(cfg.heartbeat.cheapCheck.maxSkipHours).toBe(24)
    expect(cfg.heartbeat.dailyMaxAiRuns).toBe(48)
    expect(cfg.heartbeat.onDailyLimit).toBe('warn')
    // Desktop notification (#411 0.19.0)
    expect(cfg.heartbeat.desktopNotification).toBe(true)
    // 旧 field が混入していないこと (accountId / denyDuringHeartbeat / skills)
    expect(
      (cfg.heartbeat as unknown as Record<string, unknown>).accountId,
    ).toBeUndefined()
    expect(
      (cfg.heartbeat as unknown as Record<string, unknown>).denyDuringHeartbeat,
    ).toBeUndefined()
    expect(
      (cfg.heartbeat as unknown as Record<string, unknown>).skills,
    ).toBeUndefined()
  })

  it('mergeConfig keeps target from partial', () => {
    const partial: Partial<AiConfig> = {
      heartbeat: {
        target: 'sess-abc',
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    const merged = mergeConfig(defaultConfig(), partial)
    expect(merged.heartbeat.target).toBe('sess-abc')
  })

  it('empty / null target falls back to "auto"', () => {
    const partial: Partial<AiConfig> = {
      heartbeat: {
        target: '',
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    expect(mergeConfig(defaultConfig(), partial).heartbeat.target).toBe('auto')
  })

  it('mergeConfig deep-merges partial heartbeat fields', () => {
    const partial: Partial<AiConfig> = {
      heartbeat: {
        enabled: true,
        intervalMinutes: 15,
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    const merged = mergeConfig(defaultConfig(), partial)
    expect(merged.heartbeat.enabled).toBe(true)
    expect(merged.heartbeat.intervalMinutes).toBe(15)
    // 未指定フィールドは default 維持 (= permissions も readonly のまま)
    expect(merged.heartbeat.permissions.preset).toBe('readonly')
  })

  it('intervalMinutes is clamped to MIN..MAX', () => {
    const tooSmall: Partial<AiConfig> = {
      heartbeat: {
        intervalMinutes: 0,
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    expect(
      mergeConfig(defaultConfig(), tooSmall).heartbeat.intervalMinutes,
    ).toBe(HEARTBEAT_INTERVAL_MIN_MINUTES)
    const tooBig: Partial<AiConfig> = {
      heartbeat: {
        intervalMinutes: 99999,
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    expect(mergeConfig(defaultConfig(), tooBig).heartbeat.intervalMinutes).toBe(
      HEARTBEAT_INTERVAL_MAX_MINUTES,
    )
  })

  it('NaN intervalMinutes falls back to default', () => {
    const partial: Partial<AiConfig> = {
      heartbeat: {
        intervalMinutes: Number.NaN,
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    expect(
      mergeConfig(defaultConfig(), partial).heartbeat.intervalMinutes,
    ).toBe(HEARTBEAT_INTERVAL_DEFAULT_MINUTES)
  })

  it('partial permissions preset is preserved through merge', () => {
    const partial: Partial<AiConfig> = {
      heartbeat: {
        permissions: { preset: 'safe', custom: {} },
      } as Partial<HeartbeatConfig> as HeartbeatConfig,
    }
    expect(
      mergeConfig(defaultConfig(), partial).heartbeat.permissions.preset,
    ).toBe('safe')
  })
})
