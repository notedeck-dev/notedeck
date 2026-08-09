// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
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
  category?: string
  wizard?: boolean
  onEnter?: () => void
  precheck?: () => 'skip' | 'show'
  completion?: { watch: () => unknown; isComplete: (v: unknown) => boolean }
  isFinal?: boolean
}> = []

const mockCategories: Array<{ id: string; title: string }> = []

vi.mock('@/data/tutorialSteps', () => ({
  buildTutorialSteps: () => mockSteps.map((s) => ({ ...s })),
  get TUTORIAL_CATEGORIES() {
    return mockCategories
  },
}))

const settingsSetSpy = vi.fn()
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ set: settingsSetSpy }),
}))

/** tutorial.json5 の読み書き。書き込み順とレースを検証するために差し替える */
let storedFile = ''
let deferredRead: { promise: Promise<string>; resolve: () => void } | null =
  null
const writeSpy = vi.fn()
vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readTutorialProgress: () =>
    deferredRead?.promise ?? Promise.resolve(storedFile),
  writeTutorialProgress: (content: string) => {
    writeSpy(content)
    storedFile = content
    return Promise.resolve()
  },
}))

describe('useTutorialStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockSteps.length = 0
    mockCategories.length = 0
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

describe('カテゴリ実行と実績 (#1029)', () => {
  const done = ref(false)

  beforeEach(() => {
    done.value = false
    setActivePinia(createPinia())
    mockSteps.length = 0
    mockCategories.length = 0
    settingsSetSpy.mockReset()
    writeSpy.mockReset()
    storedFile = ''
    deferredRead = null
    mockCategories.push({ id: 'getting-started', title: 'はじめに' })
    mockSteps.push(
      { id: 'welcome', title: 'W', description: '' },
      {
        id: 'a',
        title: 'A',
        description: '',
        category: 'getting-started',
        wizard: false,
        precheck: () => 'show',
      },
      {
        id: 'b',
        title: 'B',
        description: '',
        category: 'getting-started',
        wizard: false,
        precheck: () => 'show',
      },
      { id: 'complete', title: 'C', description: '', isFinal: true },
    )
  })

  it('初回ウィザードは wizard: false の step を含まない', () => {
    const store = useTutorialStore()
    store.start()
    expect(store.totalSteps).toBe(2) // welcome + complete
  })

  it('startCategory はそのカテゴリの step だけを積む', () => {
    const store = useTutorialStore()
    store.startCategory('getting-started')
    expect(store.active).toBe(true)
    expect(store.totalSteps).toBe(2)
    expect(store.currentStep?.id).toBe('a')
  })

  it('カテゴリを走り切っても完走フラグは立たない (ウィザードのものなので)', () => {
    const store = useTutorialStore()
    store.startCategory('getting-started')
    store.next()
    store.next() // 終端
    expect(settingsSetSpy).not.toHaveBeenCalled()
  })

  it('カテゴリの全項目を満たすと実績が解除される', () => {
    const store = useTutorialStore()
    // 2 項目とも達成済みの状態で走らせる
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    expect(store.progress.achievements['getting-started']).toBeDefined()
  })

  it('走らせていないカテゴリは、条件を満たしていても記録しない', () => {
    const store = useTutorialStore()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    // 一覧を開いただけ (run していない)
    store.syncProgress()
    expect(store.progress.items).toEqual({})
    expect(store.progress.achievements).toEqual({})
  })

  it('一部しか満たしていなければ実績は解除されない', () => {
    const store = useTutorialStore()
    const a = mockSteps.find((s) => s.id === 'a')
    if (a) a.precheck = () => 'skip'
    store.startCategory('getting-started')
    expect(store.progress.items['a']).toBeDefined()
    expect(store.progress.achievements['getting-started']).toBeUndefined()
  })

  it('達成済みの項目は状態が戻っても未達成にならない (latch)', () => {
    const store = useTutorialStore()
    const a = mockSteps.find((s) => s.id === 'a')
    if (a) a.precheck = () => 'skip'
    store.startCategory('getting-started')
    // カラムを閉じた相当: 状態が false に戻る
    if (a) a.precheck = () => 'show'
    expect(store.isStepDone({ id: 'a', title: 'A', description: '' })).toBe(
      true,
    )
  })

  it('完了済みのカテゴリも先頭から見直せる', () => {
    const store = useTutorialStore()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started') // 1 度目で記録が付く
    store.cancel()
    store.startCategory('getting-started') // もう一度
    expect(store.active).toBe(true)
    expect(store.replaying).toBe(true)
    expect(store.currentStep?.id).toBe('a')
  })

  it('category では達成しても自動で次に進まない (次 step が勝手に開かない)', async () => {
    let opened = false
    const a = mockSteps.find((s) => s.id === 'a')
    const b = mockSteps.find((s) => s.id === 'b')
    if (a) {
      a.completion = { watch: () => done.value, isComplete: (v) => v === true }
    }
    if (b) {
      b.onEnter = () => {
        opened = true
      }
    }
    const store = useTutorialStore()
    store.startCategory('getting-started')
    expect(store.currentStep?.id).toBe('a')
    done.value = true
    await nextTick()
    // 達成は記録されるが step は動かない
    expect(store.stepCompleted).toBe(true)
    expect(store.currentStep?.id).toBe('a')
    expect(opened).toBe(false)
    // ユーザーが [次へ] を押して初めて次の onEnter が走る
    store.next()
    expect(store.currentStep?.id).toBe('b')
    expect(opened).toBe(true)
  })

  it('完了済みを見直すとき step を飛ばさない (達成済みでも順に見せる)', () => {
    const store = useTutorialStore()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    store.cancel()
    store.startCategory('getting-started')
    expect(store.currentStep?.id).toBe('a')
    store.next()
    // precheck が満たされていても、見直し中は次の step を見せる
    expect(store.currentStep?.id).toBe('b')
    expect(store.active).toBe(true)
  })

  it('カテゴリを走り切ったら黙って閉じずに完了を示す', () => {
    const store = useTutorialStore()
    store.startCategory('getting-started')
    store.next()
    store.next() // 終端
    expect(store.runCompleted).toBe(true)
    // カードは残る。ユーザーが閉じるまで結果が見える
    expect(store.active).toBe(true)
  })

  it('完了を閉じるとカードだけが閉じる (完走フラグは立てない)', () => {
    const store = useTutorialStore()
    store.startCategory('getting-started')
    store.next()
    store.next()
    store.cancel()
    expect(store.active).toBe(false)
    expect(store.runCompleted).toBe(false)
    expect(settingsSetSpy).not.toHaveBeenCalled()
  })

  it('リセットした達成は、条件を満たしたままでも復活しない', () => {
    const store = useTutorialStore()
    // 全項目が「今も満たされている」状態 (ログイン済み・カラムがある等)
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    expect(store.progress.achievements['getting-started']).toBeDefined()
    store.cancel()

    store.resetProgress()
    // 開き直した相当。条件は満たされたままだが、消したものは戻らない
    store.syncProgress()
    expect(store.progress.items).toEqual({})
    expect(store.progress.achievements).toEqual({})
  })

  it('リセット後に新しく達成すれば、また記録される', () => {
    const store = useTutorialStore()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    store.cancel()
    store.resetProgress()
    // 走らせ直す = 明示的な再スタート
    store.startCategory('getting-started')
    expect(store.progress.items['a']).toBeDefined()
  })

  it('完走したカテゴリは、条件が戻っても完走のまま (latch 基準)', () => {
    const store = useTutorialStore()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    store.cancel()
    // カラムを閉じた相当: 状態は false に戻る
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'show'
    }
    // 一覧の ✓ と同じ基準で見直しに入る
    store.startCategory('getting-started')
    expect(store.replaying).toBe(true)
    store.next()
    expect(store.currentStep?.id).toBe('b')
  })

  it('初回ウィザード中は一覧からの実行で割り込まない', () => {
    const store = useTutorialStore()
    store.start()
    expect(store.runMode).toBe('wizard')
    const before = store.currentStep?.id
    store.startCategory('getting-started')
    expect(store.runMode).toBe('wizard')
    expect(store.currentStep?.id).toBe(before)
  })

  it('読み込み中に走り始めたら、古いファイルで記録を上書きしない', async () => {
    const store = useTutorialStore()
    storedFile = '{ version: 1, items: {} }'
    let release: () => void = () => {
      // Promise を作るまでの仮置き
    }
    deferredRead = {
      promise: new Promise<string>((r) => {
        release = () => r(storedFile)
      }),
      resolve: () => release(),
    }
    // start() は loadProgress を待たずにウィンドウを開く
    const loading = store.loadProgress()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    expect(store.progress.items['a']).toBeDefined()
    // 読み込みが後から完了しても、走行中に記録した分は消えない
    deferredRead.resolve()
    await loading
    deferredRead = null
    expect(store.progress.items['a']).toBeDefined()
  })

  it('resetProgress で達成記録が消える', () => {
    const store = useTutorialStore()
    for (const s of mockSteps) {
      if (s.category) s.precheck = () => 'skip'
    }
    store.startCategory('getting-started')
    store.resetProgress()
    expect(store.progress.items).toEqual({})
    expect(store.progress.achievements).toEqual({})
  })
})
