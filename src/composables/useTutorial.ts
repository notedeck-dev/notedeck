/**
 * useTutorial — `/tutorial` コマンドのセットアップ wizard 状態マシン。
 *
 * 設計判断:
 * - AI を呼ばない (= AI 未設定でも動くべきチュートリアルなので、AI 依存にできない)
 * - capability dispatcher を経由しない (= step の action は store API を直接叩く)
 * - 状態は system state (vault.connections / accounts) から自動派生するので、
 *   チュートリアル自身の永続セッションは持たない (= flag `tutorial.completed` のみ)
 * - UI は固定 overlay ではなく **DeckWindow として** 表示 (= 他補助 UI と paradigm 統一)。
 *   start() で windows.open('tutorial')、cancel/finish で windows.close
 *
 * 状態フロー:
 *   inactive → start() → window 開く + 最初の未 skip step に遷移 →
 *   next/skip で進む → 最終 step で finish() を呼ぶと completed flag + window close
 *
 * 外部閉鎖検出: window が UI 側で閉じられた (= ユーザーがヘッダ [×] や Esc 押下)
 * 場合も watcher で内部状態をリセットする (= 二重 close なし)
 */

import { defineStore } from 'pinia'
import { computed, ref, type WatchStopHandle, watch } from 'vue'
import { buildTutorialSteps, type TutorialStep } from '@/data/tutorialSteps'
import { useSettingsStore } from '@/stores/settings'
import { useWindowsStore } from '@/stores/windows'

export const useTutorialStore = defineStore('tutorial', () => {
  const steps = ref<TutorialStep[]>([])
  const currentIndex = ref(-1)
  const windowId = ref<string | null>(null)
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
      if (isComplete(value)) next()
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

  /** チュートリアルを開始。window を開いて最初に show すべき step に遷移する */
  function start(): void {
    if (active.value) {
      // 既に開いていれば最前面に持ってくる
      const id = windowId.value
      if (id) useWindowsStore().bringToFront(id)
      return
    }
    steps.value = buildTutorialSteps()
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
   * 次の step へ進む。途中 step を超えて isFinal の step に到達したら finish()。
   * 既に最終 step に居て呼ばれた場合も finish() で締める。
   */
  function next(): void {
    const step = currentStep.value
    if (!step) return
    if (step.isFinal) {
      finish()
      return
    }
    const nextIdx = findNextShowable(currentIndex.value + 1)
    if (nextIdx >= steps.value.length) {
      finish()
      return
    }
    enterStep(nextIdx)
  }

  /**
   * 現在 step を意図的にスキップ (= 「あとで設定する」)。次の step に進むが、
   * 最終到達時も completed flag は立てない (= ユーザーが完走したわけではない)。
   */
  function skip(): void {
    const step = currentStep.value
    if (!step) return
    if (step.isFinal) {
      cancel()
      return
    }
    const nextIdx = findNextShowable(currentIndex.value + 1)
    if (nextIdx >= steps.value.length) {
      cancel()
      return
    }
    enterStep(nextIdx)
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
    // actions
    start,
    next,
    skip,
    cancel,
    finish,
    goToStep,
  }
})
