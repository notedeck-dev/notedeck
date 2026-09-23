/**
 * AI 活動の集約状態 (#1080)。
 *
 * 「AI が今 生成中 / ツール実行中 / 承認待ち / 失敗した」を横断して見られる
 * 唯一のリアクティブ状態。発生源 (useAiChat / useAiTurn / capability
 * dispatcher / taskRunner) が begin / pulse で報告し、ペットが最初の消費者。
 * module スコープの単一状態 (stores/confirm と同じ作り)。stores に置くのは
 * taskRunner (store) からも報告するため (層の向き: stores → composables は禁止)。
 */
import { computed, ref, shallowRef } from 'vue'
import {
  PET_PULSE_DURATION_MS,
  type PetActivityCounts,
  type PetPulse,
  type PetPulseKind,
  type PetSteadyKind,
  resolvePetState,
} from '@/services/petActivity'

const counts = ref<PetActivityCounts>({ waiting: 0, running: 0, review: 0 })
const pulse = shallowRef<PetPulse | null>(null)
let pulseTimer: ReturnType<typeof setTimeout> | null = null

// pulse の期限切れは timer が pulse を null にすることで表す。computed は
// 時刻に依存しないので、残っている pulse は常に期限内として渡す
const petState = computed(() =>
  resolvePetState(
    counts.value,
    pulse.value,
    pulse.value ? pulse.value.until - 1 : 0,
  ),
)

export function useAiActivity() {
  /**
   * 恒常状態の開始。返り値の関数で終了する (二度呼んでも安全)。
   */
  function begin(kind: PetSteadyKind): () => void {
    counts.value = { ...counts.value, [kind]: counts.value[kind] + 1 }
    let ended = false
    return () => {
      if (ended) return
      ended = true
      counts.value = {
        ...counts.value,
        [kind]: Math.max(0, counts.value[kind] - 1),
      }
    }
  }

  /** 一発もの。新しい pulse は前のを置き換える */
  function pulse_(kind: PetPulseKind): void {
    const duration = PET_PULSE_DURATION_MS[kind]
    pulse.value = { state: kind, until: Date.now() + duration }
    if (pulseTimer) clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => {
      pulseTimer = null
      pulse.value = null
    }, duration)
  }

  return { petState, begin, pulse: pulse_ }
}

export function _resetAiActivityForTest(): void {
  counts.value = { waiting: 0, running: 0, review: 0 }
  pulse.value = null
  if (pulseTimer) clearTimeout(pulseTimer)
  pulseTimer = null
}
