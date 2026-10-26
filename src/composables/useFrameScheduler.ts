import { onScopeDispose } from 'vue'
import { createFrameScheduler } from '@/engine/frameScheduler'

export type { FramePriority } from '@/engine/frameScheduler'

/** `createFrameScheduler` の Vue 包み。scope の破棄で予約をまとめて取り消す */
export function useFrameScheduler() {
  const scheduler = createFrameScheduler()
  onScopeDispose(scheduler.dispose)
  return scheduler
}
