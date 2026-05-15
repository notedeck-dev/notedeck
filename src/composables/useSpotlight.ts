/**
 * useSpotlight — AI 操作の可視化機構。
 *
 * AI tool calling で UI が変化したとき、対象要素を一時的に「光らせる」ことで
 * ユーザーが「何が起きたか」を目で追えるようにする。Kifi / Claude Cowork が
 * 採用していた live UI feedback の系譜。
 *
 * 設計上の制約:
 * - トリガーは AI 操作のみ (capability dispatcher 経由)。ユーザークリックは光らない
 * - ターゲット ID は文字列規約: `navbar:${type}:${accountId ?? 'null'}` 等
 *   登録要素が無ければ no-op (= UI 側が描画していなければ単に光らない)
 *
 * memory: feedback_no_onboarding_ui (静的ツアー禁止) と区別される反応的 feedback
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

interface Spotlight {
  /** Date.now() ベースの期限 (この時刻に自動 clear される) */
  expiresAt: number
  /** SR-only テキスト用ラベル。省略時は読み上げなし */
  label?: string
}

const DEFAULT_DURATION_MS = 2400

export const useSpotlightStore = defineStore('spotlight', () => {
  // Vue reactivity のため Map は常に new Map(...) で全置換する
  const spotlights = ref<Map<string, Spotlight>>(new Map())

  // aria-live region で読み上げる最新メッセージ
  const lastAnnouncement = ref<string>('')

  /**
   * ターゲットを光らせる。
   * @param targetId  e.g. `navbar:notifications:null`
   * @param opts.label    SR 用テキスト (省略時は読み上げなし)
   * @param opts.durationMs  既定 2400ms
   */
  function highlight(
    targetId: string,
    opts: { label?: string; durationMs?: number } = {},
  ): void {
    const duration = opts.durationMs ?? DEFAULT_DURATION_MS
    const expiresAt = Date.now() + duration
    const next = new Map(spotlights.value)
    next.set(targetId, { expiresAt, label: opts.label })
    spotlights.value = next

    if (opts.label) {
      lastAnnouncement.value = opts.label
    }

    // 期限到来時に自分のエントリだけ削除する (newer な再 highlight に踏まれない)
    setTimeout(() => {
      const m = new Map(spotlights.value)
      const cur = m.get(targetId)
      if (cur && cur.expiresAt === expiresAt) {
        m.delete(targetId)
        spotlights.value = m
      }
    }, duration)
  }

  function clear(targetId?: string): void {
    if (targetId == null) {
      spotlights.value = new Map()
    } else if (spotlights.value.has(targetId)) {
      const m = new Map(spotlights.value)
      m.delete(targetId)
      spotlights.value = m
    }
  }

  function isActive(targetId: string): boolean {
    return spotlights.value.has(targetId)
  }

  /**
   * 視覚 spotlight 無しで SR 用テキストだけ流す。削除系のように DOM が
   * 消えてしまう capability や、視覚化対象が無い裏方処理の通知に使う。
   */
  function announce(message: string): void {
    if (message) lastAnnouncement.value = message
  }

  return { spotlights, lastAnnouncement, highlight, clear, isActive, announce }
})

/**
 * ターゲット ID を組み立てるヘルパー。規約変更時はここを直す。
 *
 * UI 領域固定ではなく、capability の意味に応じて使い分ける:
 * - `column:${id}` — 個別カラム (ボトムバー / モバイルナビのタブが反応)
 *   = AI が `column.add` 等で新しいデッキカラムを作ったとき
 * - `navbar:${type}:${accountId}` — ナビバーボタン (サイドバースロット)
 *   = AI がサイドバースロットの toggle / 切替を行ったとき (将来 capability)
 *
 * ナビバー = 現在のサイドバースロットを置換するトグル UI なので、新規カラム
 * 追加 (デッキへの追加) では navbar を光らせない (置換ではないため誤誘導)。
 */
export function columnTargetId(columnId: string): string {
  return `column:${columnId}`
}

export function navbarTargetId(type: string, accountId: string | null): string {
  return `navbar:${type}:${accountId ?? 'null'}`
}
