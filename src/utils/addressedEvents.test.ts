import { describe, expect, it, vi } from 'vitest'

let currentLabel: string | null = 'main'
vi.mock('@/utils/settingsFs', () => ({
  currentWindowLabel: () => currentLabel,
}))

import { listenAddressed } from '@/utils/addressedEvents'

type Payload = { to: string; url: string }

function fakeEvent() {
  let cb: ((e: { payload: Payload }) => void) | null = null
  return {
    event: {
      listen: async (handler: (e: { payload: Payload }) => void) => {
        cb = handler
        return () => {
          cb = null
        }
      },
    },
    fire(payload: Payload) {
      cb?.({ payload })
    },
    get listening() {
      return cb !== null
    },
  }
}

describe('listenAddressed (#1131)', () => {
  it('自分宛てだけ handler に渡し、他の窓宛ては捨てる', async () => {
    currentLabel = 'deck-1700000000000-1'
    const f = fakeEvent()
    const seen: string[] = []
    await listenAddressed(f.event, (p) => seen.push(p.url))
    f.fire({ to: 'main', url: 'a' })
    f.fire({ to: 'deck-1700000000000-1', url: 'b' })
    f.fire({ to: 'pip-1', url: 'c' })
    expect(seen).toEqual(['b'])
  })

  it('解除すると以後は何も受けない', async () => {
    currentLabel = 'main'
    const f = fakeEvent()
    const seen: string[] = []
    const unlisten = await listenAddressed(f.event, (p) => seen.push(p.url))
    f.fire({ to: 'main', url: 'a' })
    unlisten()
    expect(f.listening).toBe(false)
    expect(seen).toEqual(['a'])
  })

  it('label が取れない (Tauri 外) ときは何も受けない', async () => {
    currentLabel = null
    const f = fakeEvent()
    const seen: string[] = []
    await listenAddressed(f.event, (p) => seen.push(p.url))
    f.fire({ to: 'main', url: 'a' })
    expect(seen).toEqual([])
  })
})
