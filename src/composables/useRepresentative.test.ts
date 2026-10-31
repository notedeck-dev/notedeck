import { beforeEach, describe, expect, it, vi } from 'vitest'

type RolesPayload = { representative: string | null; viewing: string | null }

let announceResult: {
  label: string
  kind: 'main' | 'mirror' | 'popout' | 'pip'
  representative: string | null
  viewing: string | null
}
let rolesListener: ((e: { payload: RolesPayload }) => void) | null = null
const announce = vi.fn(async () => ({
  status: 'ok' as const,
  data: announceResult,
}))

vi.mock('@/bindings', () => ({
  commands: {
    deckWindowAnnounce: () => announce(),
  },
  events: {
    windowRolesChanged: {
      listen: async (cb: (e: { payload: RolesPayload }) => void) => {
        rolesListener = cb
        return () => {
          rolesListener = null
        }
      },
    },
  },
}))

let currentLabel: string | null = 'main'
vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  currentWindowLabel: () => currentLabel,
}))

async function load() {
  vi.resetModules()
  return await import('@/composables/useRepresentative')
}

describe('useRepresentative (#1131)', () => {
  beforeEach(() => {
    announce.mockClear()
    rolesListener = null
    currentLabel = 'main'
    announceResult = {
      label: 'main',
      kind: 'main',
      representative: 'main',
      viewing: 'main',
    }
  })

  it('名乗りの返事で自分が代表かどうかが決まる', async () => {
    const m = await load()
    const { isRepresentative, isViewing } = m.useRepresentative()
    expect(isRepresentative.value).toBe(false) // 名乗る前は否
    await m.announceWindow()
    expect(announce).toHaveBeenCalledTimes(1)
    expect(isRepresentative.value).toBe(true)
    expect(isViewing.value).toBe(true)
  })

  it('ミラーは代表ではないが、役が移れば代表になる', async () => {
    currentLabel = 'deck-1700000000000-1'
    announceResult = {
      label: currentLabel,
      kind: 'mirror',
      representative: 'main',
      viewing: 'main',
    }
    const m = await load()
    const { isRepresentative } = m.useRepresentative()
    await m.announceWindow()
    expect(isRepresentative.value).toBe(false)
    rolesListener?.({
      payload: { representative: currentLabel, viewing: currentLabel },
    })
    expect(isRepresentative.value).toBe(true)
  })

  it('名乗りは 1 回だけ (二重に呼んでも command は 1 回)', async () => {
    const m = await load()
    await Promise.all([m.announceWindow(), m.announceWindow()])
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it('whenRepresentative は代表になった時点で 1 回だけ解決する', async () => {
    currentLabel = 'deck-1700000000000-2'
    announceResult = {
      label: currentLabel,
      kind: 'mirror',
      representative: 'main',
      viewing: 'main',
    }
    const m = await load()
    await m.announceWindow()
    let resolved = false
    void m.whenRepresentative().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    rolesListener?.({
      payload: { representative: currentLabel, viewing: null },
    })
    await Promise.resolve()
    expect(resolved).toBe(true)
  })
})
