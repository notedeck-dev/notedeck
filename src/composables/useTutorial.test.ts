// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useWindowsStore } from '@/stores/windows'
import { useTutorialStore } from './useTutorial'

/**
 * step の precheck / completion / onEnter を制御するため、`buildTutorialSteps`
 * をテストごとに mock する。実 store API (vault / accounts / settings) を
 * 呼ばないようにする。windows store は実体を使う (= window 開閉の連動も検証)。
 */
const mockSteps: Array<{
  id: string
  title: string
  description: string
  onEnter?: () => void
  precheck?: () => 'skip' | 'show'
  completion?: { watch: () => unknown; isComplete: (v: unknown) => boolean }
  isFinal?: boolean
}> = []

vi.mock('@/data/tutorialSteps', () => ({
  buildTutorialSteps: () => mockSteps.map((s) => ({ ...s })),
}))

const settingsSetSpy = vi.fn()
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ set: settingsSetSpy }),
}))

describe('useTutorialStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockSteps.length = 0
    settingsSetSpy.mockReset()
  })

  it('start() で window を開き、最初の precheck=show step に遷移する', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '', precheck: () => 'skip' },
      { id: 'b', title: 'B', description: '', precheck: () => 'show' },
      { id: 'c', title: 'C', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    const windowsStore = useWindowsStore()
    store.start()
    expect(store.active).toBe(true)
    expect(store.currentStep?.id).toBe('b')
    expect(store.currentNumber).toBe(2)
    expect(store.totalSteps).toBe(3)
    expect(windowsStore.windows.some((w) => w.type === 'tutorial')).toBe(true)
  })

  it('全 step が precheck=skip なら最終 step (= complete) に遷移する', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '', precheck: () => 'skip' },
      { id: 'b', title: 'B', description: '', precheck: () => 'skip' },
      { id: 'c', title: 'C', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    store.start()
    expect(store.currentStep?.id).toBe('c')
  })

  it('next() で次の showable step へ、最終 step で finish() を呼ぶ', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '' },
      { id: 'c', title: 'C', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    const windowsStore = useWindowsStore()
    store.start()
    expect(store.currentStep?.id).toBe('a')
    store.next()
    expect(store.currentStep?.id).toBe('b')
    store.next()
    expect(store.currentStep?.id).toBe('c')
    store.next() // 最終 step → finish
    expect(store.active).toBe(false)
    expect(settingsSetSpy).toHaveBeenCalledWith('tutorial.completed', true)
    // window も閉じられる
    expect(windowsStore.windows.some((w) => w.type === 'tutorial')).toBe(false)
  })

  it('next() は precheck=skip の step を飛ばす', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '', precheck: () => 'skip' },
      { id: 'c', title: 'C', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    store.start()
    expect(store.currentStep?.id).toBe('a')
    store.next()
    expect(store.currentStep?.id).toBe('c')
  })

  it('skip() は step を進めるが、最終 step を skip すると completed flag を立てない', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    store.start()
    store.skip()
    expect(store.currentStep?.id).toBe('b')
    store.skip() // 最終 step を skip = cancel
    expect(store.active).toBe(false)
    expect(settingsSetSpy).not.toHaveBeenCalled()
  })

  it('cancel() はチュートリアルを閉じ、completed flag は立てない', () => {
    mockSteps.push({ id: 'a', title: 'A', description: '' })
    const store = useTutorialStore()
    const windowsStore = useWindowsStore()
    store.start()
    store.cancel()
    expect(store.active).toBe(false)
    expect(settingsSetSpy).not.toHaveBeenCalled()
    expect(windowsStore.windows.some((w) => w.type === 'tutorial')).toBe(false)
  })

  it('finish() を直接呼んで completed flag が立つ', () => {
    mockSteps.push({ id: 'a', title: 'A', description: '', isFinal: true })
    const store = useTutorialStore()
    store.start()
    store.finish()
    expect(store.active).toBe(false)
    expect(settingsSetSpy).toHaveBeenCalledWith('tutorial.completed', true)
  })

  it('onEnter は step 遷移時に呼ばれる', () => {
    const onEnterA = vi.fn()
    const onEnterB = vi.fn()
    mockSteps.push(
      { id: 'a', title: 'A', description: '', onEnter: onEnterA },
      {
        id: 'b',
        title: 'B',
        description: '',
        onEnter: onEnterB,
        isFinal: true,
      },
    )
    const store = useTutorialStore()
    store.start()
    expect(onEnterA).toHaveBeenCalledOnce()
    expect(onEnterB).not.toHaveBeenCalled()
    store.next()
    expect(onEnterB).toHaveBeenCalledOnce()
  })

  it('onEnter が throw しても store の state は壊れない', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected console.warn from store's defensive catch
    })
    mockSteps.push({
      id: 'a',
      title: 'A',
      description: '',
      onEnter: () => {
        throw new Error('boom')
      },
    })
    const store = useTutorialStore()
    expect(() => store.start()).not.toThrow()
    expect(store.active).toBe(true)
    consoleSpy.mockRestore()
  })

  it('完了ボタンに頼らず外部から window が close されると内部状態がリセットされる', async () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    const windowsStore = useWindowsStore()
    store.start()
    expect(store.active).toBe(true)
    const id = store.windowId
    expect(id).not.toBeNull()
    // ユーザーが window ヘッダ [×] を押した相当
    if (id) windowsStore.close(id)
    await nextTick()
    expect(store.active).toBe(false)
    // completed flag は立たない (cancel 相当)
    expect(settingsSetSpy).not.toHaveBeenCalled()
  })

  it('goToStep(i) で precheck=skip でも任意 step に手動ジャンプできる', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '', precheck: () => 'skip' },
      { id: 'c', title: 'C', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    store.start()
    expect(store.currentStep?.id).toBe('a')
    // 手動で precheck=skip の step に飛ぶ (= ドットクリック相当)
    store.goToStep(1)
    expect(store.currentStep?.id).toBe('b')
  })

  it('goToStep は範囲外 / inactive 時は no-op', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    // inactive
    store.goToStep(0)
    expect(store.active).toBe(false)
    // active 後
    store.start()
    store.goToStep(99)
    expect(store.currentStep?.id).toBe('a')
    store.goToStep(-1)
    expect(store.currentStep?.id).toBe('a')
  })

  it('多重 start() は無視され、既存 window が focus される', () => {
    mockSteps.push(
      { id: 'a', title: 'A', description: '' },
      { id: 'b', title: 'B', description: '', isFinal: true },
    )
    const store = useTutorialStore()
    const windowsStore = useWindowsStore()
    store.start()
    store.next()
    expect(store.currentStep?.id).toBe('b')
    const beforeCount = windowsStore.windows.length
    store.start() // 既に active なので二重 open しない
    expect(store.currentStep?.id).toBe('b')
    expect(windowsStore.windows.length).toBe(beforeCount)
  })
})
