import { onUnmounted } from 'vue'
import type {
  NormalizedNote,
  NoteUpdateEvent,
  StreamAdapter,
} from '@/adapters/types'
import { captureTargets } from '@/services/captureBudget'
import { usePerformanceStore } from '@/stores/performance'

/**
 * 複数アカウントの variant を、それぞれのアカウントの接続で Note Capture
 * (subNote / unsubNote) する (#1058 §6)。`useNoteCapture` の multi-stream 版。
 *
 * - 購読の上限は 1 カラム合計 (アカウント別に掛けると N 倍になる)、数えるのは
 *   実際の購読数 (規則は `services/captureBudget`)
 * - 接続を持たないアカウント (`getStreamFor` が undefined) の variant は購読しない
 * - 入れ子 (renote 元) も同じアカウントの接続で購読する
 */
export function useMultiNoteCapture(
  getStreamFor: (accountId: string) => StreamAdapter | undefined,
  onUpdate: (event: NoteUpdateEvent) => void,
) {
  const perfStore = usePerformanceStore()
  /** accountId → 購読中の noteId 集合 */
  const captured = new Map<string, Set<string>>()
  /** accountId → 購読を出した接続。接続が替わったら (再ログイン) 購読済みの記憶を捨てる */
  const capturedOn = new Map<string, StreamAdapter>()

  function sync(notes: readonly NormalizedNote[]) {
    const wanted = captureTargets(notes, perfStore.get('noteCaptureMax'))

    for (const [accountId, stream] of capturedOn) {
      if (getStreamFor(accountId) === stream) continue
      // 古い接続の購読は接続ごと消えている。新しい接続で出し直す
      captured.delete(accountId)
      capturedOn.delete(accountId)
    }

    for (const [accountId, ids] of wanted) {
      const stream = getStreamFor(accountId)
      if (!stream) continue
      let current = captured.get(accountId)
      if (!current) {
        current = new Set()
        captured.set(accountId, current)
      }
      capturedOn.set(accountId, stream)
      for (const id of ids) {
        if (!current.has(id)) {
          current.add(id)
          stream.subNote(id, onUpdate)
        }
      }
    }

    for (const [accountId, current] of captured) {
      const ids = wanted.get(accountId)
      const stream = getStreamFor(accountId)
      for (const id of current) {
        if (ids?.has(id)) continue
        current.delete(id)
        stream?.unsubNote(id, onUpdate)
      }
      if (current.size === 0) {
        captured.delete(accountId)
        capturedOn.delete(accountId)
      }
    }
  }

  function cleanup() {
    for (const [accountId, current] of captured) {
      const stream = getStreamFor(accountId)
      if (stream) for (const id of current) stream.unsubNote(id, onUpdate)
    }
    captured.clear()
    capturedOn.clear()
  }

  onUnmounted(cleanup)

  return { sync, cleanup }
}
