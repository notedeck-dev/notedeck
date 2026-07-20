import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CUSTOM_TL_ICONS,
  clearRuntimeDenied,
  detectCustomTimelines,
  detectFilterKeys,
  findModeKeyForTimeline,
  getRelatedTimelineTypes,
  getRuntimeDenied,
  markTimelineDenied,
  modeIcon,
  modeLabel,
} from '@/utils/customTimelines'
import { commands } from '@/utils/tauriInvoke'

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    apiGetEndpoints: vi.fn(),
    apiGetEndpointParams: vi.fn(),
  },
  unwrap: <T>(result: { status: string; data?: T; error?: unknown }): T => {
    if (result.status === 'ok') return result.data as T
    throw result.error
  },
}))

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({ accountMap: new Map() }),
}))

// node 環境には localStorage がないので最小スタブを用意
const storageMap = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => storageMap.set(key, value),
  removeItem: (key: string) => storageMap.delete(key),
})

const mockedCommands = vi.mocked(commands)

beforeEach(() => {
  storageMap.clear()
  vi.clearAllMocks()
})

describe('getRelatedTimelineTypes', () => {
  it('expands local/social to the shared ltlAvailable group', () => {
    expect(getRelatedTimelineTypes('local')).toEqual(['local', 'social'])
    expect(getRelatedTimelineTypes('social')).toEqual(['local', 'social'])
  })

  it('returns global alone (gtlAvailable group)', () => {
    expect(getRelatedTimelineTypes('global')).toEqual(['global'])
  })

  it('returns unknown types as a singleton', () => {
    expect(getRelatedTimelineTypes('bubble')).toEqual(['bubble'])
    expect(getRelatedTimelineTypes('home')).toEqual(['home'])
  })
})

describe('modeLabel', () => {
  it('converts isIn*Mode keys to Japanese labels', () => {
    expect(modeLabel('isInYamiMode')).toBe('Yamiモード')
    expect(modeLabel('isInSilentMode')).toBe('Silentモード')
  })

  it('returns non-matching keys unchanged', () => {
    expect(modeLabel('ltlAvailable')).toBe('ltlAvailable')
    expect(modeLabel('')).toBe('')
  })
})

describe('modeIcon', () => {
  it('uses moon icons for yami mode', () => {
    expect(modeIcon('isInYamiMode', true)).toBe('moon')
    expect(modeIcon('isInYamiMode', false)).toBe('moon-off')
  })

  it('falls back to toggle icons for unknown modes', () => {
    expect(modeIcon('isInFooMode', true)).toBe('toggle-right')
    expect(modeIcon('isInFooMode', false)).toBe('toggle-left')
  })
})

describe('findModeKeyForTimeline', () => {
  it('matches a timeline type that starts with the mode name', () => {
    expect(findModeKeyForTimeline('yami', { isInYamiMode: true })).toBe(
      'isInYamiMode',
    )
    // 'hanami' starts with 'hana' → isInHanaMode
    expect(findModeKeyForTimeline('hanami', { isInHanaMode: false })).toBe(
      'isInHanaMode',
    )
  })

  it('returns undefined when nothing matches', () => {
    expect(findModeKeyForTimeline('bubble', { isInYamiMode: true })).toBe(
      undefined,
    )
    expect(findModeKeyForTimeline('yami', {})).toBe(undefined)
  })

  it('ignores keys that are not isIn*Mode shaped', () => {
    expect(findModeKeyForTimeline('yami', { yamiEnabled: true })).toBe(
      undefined,
    )
  })
})

describe('runtime denied set', () => {
  it('marks, reads and clears denied timeline types per account', () => {
    expect(getRuntimeDenied('acc1').size).toBe(0)

    markTimelineDenied('acc1', 'local')
    markTimelineDenied('acc1', 'global')
    markTimelineDenied('acc2', 'social')

    expect([...getRuntimeDenied('acc1')].sort()).toEqual(['global', 'local'])
    expect([...getRuntimeDenied('acc2')]).toEqual(['social'])

    clearRuntimeDenied('acc1')
    expect(getRuntimeDenied('acc1').size).toBe(0)
    expect([...getRuntimeDenied('acc2')]).toEqual(['social'])
    clearRuntimeDenied('acc2')
  })
})

describe('detectCustomTimelines', () => {
  it('detects notes/*-timeline endpoints excluding standard ones', async () => {
    mockedCommands.apiGetEndpoints.mockResolvedValue({
      status: 'ok',
      data: [
        'notes/timeline',
        'notes/local-timeline',
        'notes/hybrid-timeline',
        'notes/global-timeline',
        'notes/user-list-timeline',
        'notes/bubble-timeline',
        'notes/foo-timeline',
        'notes/show',
        'users/notes',
      ],
    })

    const result = await detectCustomTimelines('host-a.example')
    expect(result).toEqual([
      { type: 'bubble', label: 'Bubble', icon: CUSTOM_TL_ICONS.bubble },
      { type: 'foo', label: 'Foo', icon: expect.any(String) },
    ])
    // unknown type falls back to the generic icon (not a known one)
    expect(Object.values(CUSTOM_TL_ICONS)).not.toContain(result[1]?.icon)
  })

  it('serves the second call from memory cache without a network hit', async () => {
    mockedCommands.apiGetEndpoints.mockResolvedValue({
      status: 'ok',
      data: ['notes/bubble-timeline'],
    })

    const first = await detectCustomTimelines('host-b.example')
    const second = await detectCustomTimelines('host-b.example')
    expect(second).toEqual(first)
    expect(mockedCommands.apiGetEndpoints).toHaveBeenCalledTimes(1)
  })

  it('uses a fresh localStorage cache without a network hit', async () => {
    const cached = [{ type: 'yami', label: 'Yami', icon: 'p' }]
    storageMap.set(
      'nd:custom_tl:host-c.example',
      JSON.stringify({ data: cached, updatedAt: Date.now() }),
    )

    const result = await detectCustomTimelines('host-c.example')
    expect(result).toEqual(cached)
    expect(mockedCommands.apiGetEndpoints).not.toHaveBeenCalled()
  })

  it('returns empty array when the network fails and no cache exists', async () => {
    mockedCommands.apiGetEndpoints.mockResolvedValue({
      status: 'error',
      error: { code: 'E_TEST', message: 'boom' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* suppress expected warning */
    })
    expect(await detectCustomTimelines('host-d.example')).toEqual([])
    warn.mockRestore()
  })
})

describe('detectFilterKeys', () => {
  it('maps supported params including fork aliases to canonical keys', async () => {
    mockedCommands.apiGetEndpointParams.mockResolvedValue({
      status: 'ok',
      data: ['withRenotes', 'excludeBots', 'excludeNsfw', 'somethingElse'],
    })

    const keys = await detectFilterKeys('host-e.example', 'local')
    expect(keys).toEqual(['withRenotes', 'withBots', 'withSensitive'])
    expect(mockedCommands.apiGetEndpointParams).toHaveBeenCalledWith(
      'host-e.example',
      'notes/local-timeline',
    )
  })

  it('probes custom timeline types via notes/<type>-timeline', async () => {
    mockedCommands.apiGetEndpointParams.mockResolvedValue({
      status: 'ok',
      data: ['withFiles'],
    })

    const keys = await detectFilterKeys('host-f.example', 'bubble')
    expect(keys).toEqual(['withFiles'])
    expect(mockedCommands.apiGetEndpointParams).toHaveBeenCalledWith(
      'host-f.example',
      'notes/bubble-timeline',
    )
  })

  it('caches per host:endpoint', async () => {
    mockedCommands.apiGetEndpointParams.mockResolvedValue({
      status: 'ok',
      data: ['withReplies'],
    })

    await detectFilterKeys('host-g.example', 'home')
    await detectFilterKeys('host-g.example', 'home')
    expect(mockedCommands.apiGetEndpointParams).toHaveBeenCalledTimes(1)
  })

  it('returns empty array on error', async () => {
    mockedCommands.apiGetEndpointParams.mockResolvedValue({
      status: 'error',
      error: { code: 'E_TEST', message: 'nope' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* suppress expected warning */
    })
    expect(await detectFilterKeys('host-h.example', 'global')).toEqual([])
    warn.mockRestore()
  })
})
