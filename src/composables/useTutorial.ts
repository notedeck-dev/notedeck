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
  clearProgress,
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
  /**
   * 見直しモード。完了済みのカテゴリをもう一度走らせているとき true。
   * 達成済みでも step を飛ばさずに順に見せる (precheck による自動 skip は
   * 「まだやっていないところまで進める」ためのもので、見直しでは邪魔になる)。
   */
  const replaying = ref(false)
  /** カテゴリを走り切った。カードに完了を出し、閉じるのはユーザーに任せる */
  const runCompleted = ref(false)
  /** 今走らせているカテゴリ。一覧側で「案内を表示」に切り替えるのに使う */
  const runningCategoryId = ref<TutorialCategoryId | null>(null)
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
    // 入った時点で既に満たされているなら、その場で達成を出す。watch は値の
    // 変化しか見ないので、これが無いと見直し中は一度も達成が出ない
    if (runMode.value === 'category' && isComplete(getValue())) {
      stepCompleted.value = true
    }
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
    replaying.value = false
    runCompleted.value = false
    runningCategoryId.value = null
  }

  // --- 達成記録 (tutorial.json5) ---

  /**
   * 進行中の書き込み。読む前にこれを待つ (書き込み途中のファイルを読んで、
   * 消したはずの記録を復元してしまうのを防ぐ / #716 と同じ直列化)。
   */
  let pendingWrite: Promise<unknown> = Promise.resolve()

  function queueWrite(next: TutorialProgress): void {
    pendingWrite = pendingWrite
      .catch(() => {
        // 直前の書き込みが失敗していても、次の書き込みは試す
      })
      .then(() => writeTutorialProgress(serializeTutorialProgress(next)))
      .catch((e) => {
        console.warn('[tutorial] failed to write tutorial.json5 (ignored):', e)
      })
  }

  /** 保存済みの達成記録を読む。ブラウザ (非 Tauri) では何もしない */
  async function loadProgress(): Promise<void> {
    if (!isTauri) return
    // 走行中に読み直すと、まだ保存し切っていない達成が巻き戻る
    if (active.value) return
    try {
      await pendingWrite.catch(() => {
        // 書き込みの成否は問わない。読む前に完了していればよい
      })
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
      await pendingWrite.catch(() => {
        // 書き込みの成否は問わない。読む前に完了していればよい
      })
      const stored = parseTutorialProgress(await readTutorialProgress())
      const merged = mergeProgress(stored, progress.value)
      progress.value = merged
      queueWrite(merged)
      await pendingWrite
    } catch (e) {
      console.warn('[tutorial] failed to write tutorial.json5 (ignored):', e)
    }
  }

  /**
   * step が達成済みか。記録 (latch) だけで判定する。
   *
   * 「今の状態が条件を満たしているか」(precheck) は混ぜない。状態は戻る
   * ものなので混ぜると判定がその都度変わり、一覧の ✓ と走行時の分岐が
   * ずれる (完走済みなのに「もう一度」が途中で終わる、等)。precheck は
   * 走行中に「もう済んでいる step を飛ばす」ためだけに使う。
   */
  function isStepDone(step: TutorialStep): boolean {
    return progress.value.items[step.id] != null
  }

  /** カテゴリの全項目が記録済みか */
  function isCategoryDone(categoryId: TutorialCategoryId): boolean {
    const members = buildTutorialSteps().filter(
      (s) => s.category === categoryId,
    )
    return members.length > 0 && members.every((s) => isStepDone(s))
  }

  /**
   * 走行中の step の達成を記録し、カテゴリを完走していれば実績を解除する。
   *
   * 状態から拾うのは「今走らせているカテゴリの step」だけに限る。全 step を
   * 毎回評価すると、チュートリアルを使わずに条件を満たしていた分まで窓を
   * 開いた瞬間にまとめて解除され、通知が数件同時に飛ぶ。実績は
   * 「チュートリアルを走らせて満たしたもの」に揃える。
   */
  function syncProgress(): void {
    const now = Date.now()
    let next = progress.value
    for (const step of steps.value) {
      if (!step.category) continue
      if (next.items[step.id] == null && step.precheck?.() === 'skip') {
        next = markItemDone(next, step.id, now)
      }
    }
    const all = buildTutorialSteps()
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
    // 消した時刻を残す。状態が続いている項目 (ログイン済み・カラムがある)
    // は、これが無いと次の評価で全部書き戻り、実績が復活して通知まで再送される
    const cleared = clearProgress(Date.now())
    progress.value = cleared
    if (!isTauri) return
    // saveProgress は保存済みの記録と統合するので、消す時は使えない
    void writeTutorialProgress(serializeTutorialProgress(cleared)).catch(
      (e) => {
        console.warn('[tutorial] failed to reset tutorial.json5 (ignored):', e)
      },
    )
  }

  /**
   * 次に見せる step の index。見直し中は precheck を無視して素直に進める。
   */
  function advanceFrom(i: number): number {
    return replaying.value ? i : findNextShowable(i)
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
    runCompleted.value = false
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
    replaying.value = false
    runningCategoryId.value = null
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
    // 初回ウィザードの最中は割り込まない。差し替えるとウィザードが黙って
    // 消え、完走フラグが永久に立たなくなる (再開の導線は初回起動時のみ)
    if (active.value && runMode.value === 'wizard') {
      focusCard()
      return
    }
    const members = buildTutorialSteps().filter(
      (s) => s.category === categoryId,
    )
    if (members.length === 0) return
    // 走行中なら差し替える (別カテゴリをクリックした場合)
    teardownStepWatcher()
    steps.value = members
    runMode.value = 'category'
    runningCategoryId.value = categoryId
    // 記録済みで完走しているなら見直し。一覧の ✓ と同じ基準にする
    // (precheck 基準にすると、カラムを閉じただけで判定がずれる)。
    // 以降の遷移でも step を飛ばさない — 入口だけ強制すると、次へを押した
    // 瞬間に残りが全部 skip されて黙って終わる
    replaying.value = isCategoryDone(categoryId)
    const found = findNextShowable(0)
    const startIdx = replaying.value
      ? 0
      : Math.min(found, steps.value.length - 1)
    if (!active.value) {
      windowId.value = useWindowsStore().open('tutorial', {})
      installWindowWatcher()
    }
    enterStep(startIdx)
    // 入った時点で既に満たされている step を拾う。watcher は値の変化しか
    // 見ないので、ここで記録しないと「済んでいるのに未達成」が残る
    syncProgress()
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
    const nextIdx = advanceFrom(currentIndex.value + 1)
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
    // 黙って閉じない。走り切ったことを見せて、閉じるのはユーザーに任せる
    teardownStepWatcher()
    stepCompleted.value = false
    runCompleted.value = true
  }

  /**
   * 現在 step を意図的にスキップ (= 「あとで設定する」)。次の step に進むが、
   * 最終到達時も completed flag は立てない (= ユーザーが完走したわけではない)。
   */
  function skip(): void {
    const step = currentStep.value
    if (!step) return
    const nextIdx = advanceFrom(currentIndex.value + 1)
    if (step.isFinal || nextIdx >= steps.value.length) {
      // wizard は完走扱いにせず閉じる。category は完了を見せる
      if (runMode.value === 'category') {
        endRun()
        return
      }
      cancel()
      return
    }
    enterStep(nextIdx)
  }

  /** 走行中の案内カードを最前面に出す */
  function focusCard(): void {
    const id = windowId.value
    if (id) useWindowsStore().bringToFront(id)
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
    replaying,
    runCompleted,
    runningCategoryId,
    // actions
    start,
    startCategory,
    focusCard,
    next,
    skip,
    cancel,
    finish,
    goToStep,
    isStepDone,
    isCategoryDone,
    syncProgress,
    loadProgress,
    resetProgress,
  }
})
