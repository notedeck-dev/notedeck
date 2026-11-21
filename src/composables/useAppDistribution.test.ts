import { beforeEach, describe, expect, it, vi } from 'vitest'

const appDistribution = vi.fn()

vi.mock('@/bindings', () => ({ commands: { appDistribution } }))
vi.mock('@/utils/settingsFs', () => ({ isTauri: true }))

async function load() {
  vi.resetModules()
  return await import('./useAppDistribution')
}

describe('useAppDistribution (#849)', () => {
  beforeEach(() => {
    appDistribution.mockReset()
  })

  it('答えが届くまでは、自分で更新・登録する操作を出さない', async () => {
    let answer: (d: string) => void = () => undefined
    appDistribution.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { useAppDistribution, resolveAppDistribution } = await load()
    const { managesItself, isMicrosoftStore } = useAppDistribution()
    expect(managesItself.value).toBe(false)
    expect(isMicrosoftStore.value).toBe(false)

    answer('direct')
    await resolveAppDistribution()
    expect(managesItself.value).toBe(true)
  })

  it('Microsoft Store 版では、答えが届いた後も出さない', async () => {
    appDistribution.mockResolvedValue('microsoftStore')
    const { useAppDistribution, resolveAppDistribution } = await load()
    const { managesItself, isMicrosoftStore } = useAppDistribution()
    await resolveAppDistribution()
    expect(managesItself.value).toBe(false)
    expect(isMicrosoftStore.value).toBe(true)
  })

  it('聞けなかったときは不明のままで、出さない', async () => {
    appDistribution.mockRejectedValue(new Error('ipc failed'))
    const { useAppDistribution, resolveAppDistribution } = await load()
    const { managesItself, distribution } = useAppDistribution()
    await expect(resolveAppDistribution()).resolves.toBe('unknown')
    expect(distribution.value).toBe('unknown')
    expect(managesItself.value).toBe(false)
  })

  it('聞くのは 1 回だけ', async () => {
    appDistribution.mockResolvedValue('direct')
    const { useAppDistribution, resolveAppDistribution } = await load()
    useAppDistribution()
    useAppDistribution()
    await resolveAppDistribution()
    expect(appDistribution).toHaveBeenCalledTimes(1)
  })
})
