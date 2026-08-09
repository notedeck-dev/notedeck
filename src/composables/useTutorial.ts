/**
 * useTutorial — チュートリアルの状態マシン。
 *
 * 2 つの走らせ方を持つ (#1029):
 * - **wizard**: 初回起動時の線形セットアップ。完走で `tutorial.completed`
 * - **category**: チュートリアル設定のチェックリストから選んだカテゴリを
 *   走らせる。完走しても `tutorial.completed` は触らない (ウィザードの
 *   完走フラグなので)。案内カードは閉じるが、設定ウィンドウは開いたまま
 *
 * 設計判断:
 * - AI を呼ばない (= AI 未設定でも動くべきチュートリアルなので、AI 依存にできない)
 * - capability dispatcher を経由しない (= step の action は store API を直接叩く)
 * - 完了判定は system state (vault.connections / accounts / columns) からの導出が
 *   基本。ただし「カラムを開いた」は閉じると false に戻るため、一度満たしたら
 *   戻らない latch として tutorial.json5 に残す
 * - UI は固定 overlay ではなく **DeckWindow として** 表示 (= 他補助 UI と paradigm 統一)
 *
 * 外部閉鎖検出: window が UI 側で閉じられた (= ユーザーがヘッダ [×] や Esc 押下)
 * 場合も watcher で内部状態をリセットする (= 二重 close なし)
 */

import { defineStore } from 'pinia'
import { computed, ref, type WatchStopHandle, watch } from 'vue'
import {
  buildTutorialSteps,
  TUTORIAL_CATEGORIES,
  type TutorialCategoryId,
  type TutorialStep,
} from '@/data/tutorialSteps'
import {
  emptyProgress,
  markItemDone,
  mergeProgress,
  parseTutorialProgress,
  serializeTutorialProgress,
  type TutorialProgress,
  unlockAchievement,
} from '@/services/tutorialProgress'
import { useSettingsStore } from '@/stores/settings'
import { useWindowsStore } from '@/stores/windows'
import {
  isTauri,
  readTutorialProgress,
  writeTutorialProgress,
} from '@/utils/settingsFs'

export type TutorialRunMode = 'wizard' | 'category'

export const useTutorialStore = defineStore('tutorial', () => {
  const steps = ref<TutorialStep[]>([])
  const currentIndex = ref(-1)
  const windowId = ref<string | null>(null)
  const runMode = ref<TutorialRunMode>('wizard')
  const progress = ref<TutorialProgress>(emptyProgress())
  /**
   * category 実行で、今の step の達成条件が満たされたか。カードに達成を出して
   * [次へ] を待つために使う (wizard は自動で進むので常に false)。
   */
  const stepCompleted = ref(false)
  const active = computed(() => windowId.value !== null)
  const currentStep = computed<TutorialStep | null>(() => {
    if (currentIndex.value < 0 || currentIndex.value >= steps.value.length) {
      return null
    }
    return steps.value[currentIndex.value] ?? null
  })
  // step 数 (UI 表示: "チュートリアル 2/4")。current が 1-indexed で見える
  const totalSteps = computed(() => steps.value.length)
  const currentNumber = computed(() => currentIndex.value + 1)

  let stopStepWatcher: WatchStopHandle | null = null
  let stopWindowWatcher: WatchStopHandle | null = null

  /**
   * 現在の step の completion watcher を設置する。値が変化して isComplete が
   * true を返した瞬間に next() を呼ぶ。
   */
  function installStepWatcher(): void {
    teardownStepWatcher()
    const step = currentStep.value
    if (!step?.completion) return
    const { watch: getValue, isComplete } = step.completion
    stopStepWatcher = watch(getValue, (value) => {
      if (!isComplete(value)) return
      // 達成の瞬間に記録する。カラムを閉じると状態は false に戻るので、
      // ここで latch しないと「開いた」ことが失われる
      const done = currentStep.value
      if (done?.category) {
        progress.value = markItemDone(progress.value, done.id, Date.now())
      }
      syncProgress()
      if (runMode.value === 'wizard') {
        next()
        return
      }
      // category では自動で次に進めない。次 step の onEnter (ウィンドウや
      // カラム追加 UI を開く) がユーザーの操作なしに連鎖してしまうため、
      // 達成を見せて [次へ] を待つ
      stepCompleted.value = true
    })
  }

  function teardownStepWatcher(): void {
    stopStepWatcher?.()
    stopStepWatcher = null
  }

  /**
   * ユーザーが window のヘッダ [×] や Esc で閉じた場合の検出。windowsStore に
   * 該当 id が無くなったら内部状態をリセット (= 二重 close せずに済む)。
   */
  function installWindowWatcher(): void {
    teardownWindowWatcher()
    const windowsStore = useWindowsStore()
    stopWindowWatcher = watch(
      () => windowsStore.windows.map((w) => w.id),
      (ids) => {
        const id = windowId.value
        if (id && !ids.includes(id)) {
          // 外部閉鎖 → 内部リセットのみ (close は呼ばない)
          resetState()
        }
      },
    )
  }

  function teardownWindowWatcher(): void {
    stopWindowWatcher?.()
    stopWindowWatcher = null
  }

  function resetState(): void {
    teardownStepWatcher()
    teardownWindowWatcher()
    currentIndex.value = -1
    steps.value = []
    windowId.value = null
    stepCompleted.value = false
  }

  // --- 達成記録 (tutorial.json5) ---

  /** 保存済みの達成記録を読む。ブラウザ (非 Tauri) では何もしない */
  async function loadProgress(): Promise<void> {
    if (!isTauri) return
    try {
      progress.value = parseTutorialProgress(await readTutorialProgress())
    } catch (e) {
      console.warn('[tutorial] failed to read tutorial.json5 (ignored):', e)
    }
  }

  /**
   * 達成記録を保存する。別ウィンドウが書いた分を消さないよう、
   * 直前の保存内容と統合してから書く。
   */
  async function saveProgress(): Promise<void> {
    if (!isTauri) return
    try {
      const stored = parseTutorialProgress(await readTutorialProgress())
      const merged = mergeProgress(stored, progress.value)
      progress.value = merged
      await writeTutorialProgress(serializeTutorialProgress(merged))
    } catch (e) {
      console.warn('[tutorial] failed to write tutorial.json5 (ignored):', e)
    }
  }

  /** step が達成済みか。記録済み (latch) か、今の状態で満たされていれば true */
  function isStepDone(step: TutorialStep): boolean {
    if (progress.value.items[step.id] != null) return true
    return step.precheck?.() === 'skip'
  }

  /**
   * 全 step の達成状況を評価して記録に反映し、カテゴリを完走していれば
   * 実績を解除する。チェックリスト表示時と step 完了時に呼ぶ。
   */
  function syncProgress(): void {
    const all = buildTutorialSteps()
    const now = Date.now()
    let next = progress.value
    for (const step of all) {
      if (!step.category) continue
      if (next.items[step.id] == null && step.precheck?.() === 'skip') {
        next = markItemDone(next, step.id, now)
      }
    }
    for (const category of TUTORIAL_CATEGORIES) {
      if (next.achievements[category.id] != null) continue
      const members = all.filter((s) => s.category === category.id)
      if (members.length === 0) continue
      if (members.every((s) => next.items[s.id] != null)) {
        // 解除の知らせは通知欄が達成記録から合成する (#1029)
        next = unlockAchievement(next, category.id, now)
      }
    }
    if (next === progress.value) return
    progress.value = next
    void saveProgress()
  }

  /**
   * 達成記録をすべて消す。状態から導出できる項目 (ログイン済みなど) は
   * 次の評価で戻るが、latch していた項目 (カラムを開いた) は未達成に戻る。
   */
  function resetProgress(): void {
    const cleared = emptyProgress()
    progress.value = cleared
    if (!isTauri) return
    // saveProgress は保存済みの記録と統合するので、消す時は使えない
    void writeTutorialProgress(serializeTutorialProgress(cleared)).catch(
      (e) => {
        console.warn('[tutorial] failed to reset tutorial.json5 (ignored):', e)
      },
    )
  }

  /** index `i` から始めて、precheck=skip を満たさない最初の step の index を返す */
  function findNextShowable(i: number): number {
    for (let idx = i; idx < steps.value.length; idx++) {
      const step = steps.value[idx]
      if (!step) continue
      const precheck = step.precheck
      if (!precheck || precheck() === 'show') return idx
    }
    return steps.value.length // 全て skip = 終端を超えた値
  }

  function enterStep(i: number): void {
    teardownStepWatcher()
    stepCompleted.value = false
    currentIndex.value = i
    const step = currentStep.value
    if (!step) return
    try {
      step.onEnter?.()
    } catch (e) {
      console.warn('[tutorial] step.onEnter failed (ignored):', e)
    }
    installStepWatcher()
  }

  /**
   * 任意の step に直接ジャンプ (= 進捗 dots クリック)。precheck=skip も無視
   * して手動で訪問可能にする — 「すでに設定済みだけど確認したい」用途。
   */
  function goToStep(index: number): void {
    if (!active.value) return
    if (index < 0 || index >= steps.value.length) return
    enterStep(index)
  }

  /**
   * 初回セットアップのウィザードを開始する。API キーを要する step は
   * 必須線に含めない (#1012)。
   */
  function start(): void {
    if (active.value) {
      // 既に開いていれば最前面に持ってくる
      const id = windowId.value
      if (id) useWindowsStore().bringToFront(id)
      return
    }
    void loadProgress()
    steps.value = buildTutorialSteps().filter((s) => s.wizard !== false)
    runMode.value = 'wizard'
    windowId.value = useWindowsStore().open('tutorial', {})
    installWindowWatcher()
    const startIdx = findNextShowable(0)
    if (startIdx >= steps.value.length) {
      // 全て precheck で skip された = セットアップ完了済み
      // 最後の step (= complete) を強制表示する
      enterStep(steps.value.length - 1)
      return
    }
    enterStep(startIdx)
  }

  /**
   * チェックリスト (チュートリアル設定) から 1 カテゴリを走らせる。
   * 案内カードは wizard と同じウィンドウを使い、終わったら閉じる。
   * チュートリアル設定ウィンドウは開いたまま残る。
   */
  function startCategory(categoryId: TutorialCategoryId): void {
    const members = buildTutorialSteps().filter(
      (s) => s.category === categoryId,
    )
    if (members.length === 0) return
    // 走行中なら差し替える (別カテゴリをクリックした場合)
    teardownStepWatcher()
    steps.value = members
    runMode.value = 'category'
    // 全て達成済みなら先頭から見直す (完了したカテゴリをもう一度やれる)
    const found = findNextShowable(0)
    const startIdx = found >= steps.value.length ? 0 : found
    if (!active.value) {
      windowId.value = useWindowsStore().open('tutorial', {})
      installWindowWatcher()
    }
    enterStep(startIdx)
  }

  /**
   * 次の step へ進む。途中 step を超えて isFinal の step に到達したら finish()。
   * 既に最終 step に居て呼ばれた場合も finish() で締める。
   */
  function next(): void {
    const step = currentStep.value
    if (!step) return
    if (step.isFinal) {
      endRun()
      return
    }
    const nextIdx = findNextShowable(currentIndex.value + 1)
    if (nextIdx >= steps.value.length) {
      endRun()
      return
    }
    enterStep(nextIdx)
  }

  /**
   * run の終端。wizard は完走フラグを立てて閉じる。category は達成を記録して
   * カードを閉じるだけ (完走フラグはウィザードのものなので触らない)。
   */
  function endRun(): void {
    if (runMode.value === 'wizard') {
      finish()
      return
    }
    syncProgress()
    cancel()
  }

  /**
   * 現在 step を意図的にスキップ (= 「あとで設定する」)。次の step に進むが、
   * 最終到達時も completed flag は立てない (= ユーザーが完走したわけではない)。
   */
  function skip(): void {
    const step = currentStep.value
    if (!step) return
    const isLast =
      step.isFinal ||
      findNextShowable(currentIndex.value + 1) >= steps.value.length
    if (isLast) {
      // wizard / category いずれも完走扱いにはせずカードを閉じる
      if (runMode.value === 'category') syncProgress()
      cancel()
      return
    }
    enterStep(findNextShowable(currentIndex.value + 1))
  }

  /** チュートリアルを途中で閉じる。completed flag は立てない */
  function cancel(): void {
    const id = windowId.value
    resetState()
    if (id) useWindowsStore().close(id)
  }

  /** 最終 step まで到達。completed flag を立てて閉じる */
  function finish(): void {
    const id = windowId.value
    resetState()
    useSettingsStore().set('tutorial.completed', true)
    if (id) useWindowsStore().close(id)
  }

  return {
    // state
    active,
    currentStep,
    currentNumber,
    totalSteps,
    windowId,
    runMode,
    progress,
    stepCompleted,
    // actions
    start,
    startCategory,
    next,
    skip,
    cancel,
    finish,
    goToStep,
    isStepDone,
    syncProgress,
    loadProgress,
    resetProgress,
  }
})
