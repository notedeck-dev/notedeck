/**
 * useGuide — `/guide` コマンドのセットアップ wizard 状態マシン。
 *
 * 設計判断:
 * - AI を呼ばない (= AI 未設定でも動くべきガイドなので、AI 依存にできない)
 * - capability dispatcher を経由しない (= step の action は store API を直接叩く)
 * - 状態は system state (vault.connections / accounts) から自動派生するので、
 *   ガイド自身の永続セッションは持たない (=一度きりの flag `guide.completed` のみ)
 *
 * 状態フロー:
 *   inactive → start() → 最初の未 skip step に遷移 → next/skip で進む →
 *   最終 step で finish() を呼ぶと completed flag = true + inactive に戻る
 */

import { defineStore } from 'pinia'
import { computed, ref, type WatchStopHandle, watch } from 'vue'
import { buildGuideSteps, type GuideStep } from '@/data/guideSteps'
import { useSettingsStore } from '@/stores/settings'

export const useGuideStore = defineStore('guide', () => {
  const steps = ref<GuideStep[]>([])
  const currentIndex = ref(-1)
  const active = computed(() => currentIndex.value >= 0)
  const currentStep = computed<GuideStep | null>(() => {
    if (currentIndex.value < 0 || currentIndex.value >= steps.value.length) {
      return null
    }
    return steps.value[currentIndex.value] ?? null
  })
  // step 数 (UI 表示: "ガイド 2/4")。current が 1-indexed で見える
  const totalSteps = computed(() => steps.value.length)
  const currentNumber = computed(() => currentIndex.value + 1)

  let stopWatcher: WatchStopHandle | null = null

  /**
   * 現在の step の completion watcher を設置する。値が変化して isComplete が
   * true を返した瞬間に next() を呼ぶ。
   */
  function installWatcher(): void {
    teardownWatcher()
    const step = currentStep.value
    if (!step?.completion) return
    const { watch: getValue, isComplete } = step.completion
    stopWatcher = watch(getValue, (value) => {
      if (isComplete(value)) next()
    })
  }

  function teardownWatcher(): void {
    stopWatcher?.()
    stopWatcher = null
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
    teardownWatcher()
    currentIndex.value = i
    const step = currentStep.value
    if (!step) return
    try {
      step.onEnter?.()
    } catch (e) {
      console.warn('[guide] step.onEnter failed (ignored):', e)
    }
    installWatcher()
  }

  /** ガイドを開始。最初に show すべき step に遷移する */
  function start(): void {
    if (active.value) return // 多重起動防止
    steps.value = buildGuideSteps()
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

  /** ガイドを途中で閉じる。completed flag は立てない */
  function cancel(): void {
    teardownWatcher()
    currentIndex.value = -1
    steps.value = []
  }

  /** 最終 step まで到達。completed flag を立てて閉じる */
  function finish(): void {
    teardownWatcher()
    currentIndex.value = -1
    steps.value = []
    useSettingsStore().set('guide.completed', true)
  }

  return {
    // state
    active,
    currentStep,
    currentNumber,
    totalSteps,
    // actions
    start,
    next,
    skip,
    cancel,
    finish,
  }
})
