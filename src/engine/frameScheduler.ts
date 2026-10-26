import { type FramePhase, frameEngine } from './frameEngine'

/**
 * Frame-aware priority scheduler (Vue 非依存)。
 *
 * 既存の API (high/normal/idle) を Frame Engine の phase に写して RAF ループへ
 * 流す。store のようにアプリと同じ寿命のものはこれを直接使い、コンポーネント
 * は scope と一緒に dispose する包み (`useFrameScheduler`) を使う (#1098)。
 *
 * - high:   'input' phase（ユーザー入力応答）
 * - normal: 'write' phase（ストリーミング、DOM更新）
 * - idle:   'idle' phase（プリフェッチ、キャッシュ更新）
 */
export type FramePriority = 'high' | 'normal' | 'idle'

const PHASE_MAP: Record<FramePriority, FramePhase> = {
  high: 'input',
  normal: 'write',
  idle: 'idle',
}

export function createFrameScheduler() {
  const tracked = new Set<() => void>()

  function schedule(fn: () => void, priority: FramePriority = 'normal'): void {
    tracked.add(fn)
    frameEngine.schedule(PHASE_MAP[priority], fn)
  }

  function cancel(fn: () => void): void {
    tracked.delete(fn)
    frameEngine.cancel(fn)
  }

  function dispose() {
    for (const fn of tracked) {
      frameEngine.cancel(fn)
    }
    tracked.clear()
  }

  return { schedule, cancel, dispose }
}
