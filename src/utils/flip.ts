// FLIP (First, Last, Invert, Play) による位置変化の補間。並びが変わる前に
// 要素の位置を記録し、変わった後に「元の位置 → 新しい位置」を WAAPI で再生する。
// 追加・削除・並べ替えで残った要素が瞬間移動しないようにする。

import { motionDuration, motionEasing } from '@/utils/motion'

export type FlipSnapshot = Map<string, { x: number; y: number }>

/**
 * 位置を記録する。座標はスクロール容器の中身基準 (scrollLeft / scrollTop を
 * 足す) にして、記録と再生の間に容器がスクロールしても動いたと見なさない
 */
export function captureFlip(
  elements: Iterable<HTMLElement>,
  keyOf: (el: HTMLElement) => string | undefined,
  container?: HTMLElement | null,
): FlipSnapshot {
  const sx = container?.scrollLeft ?? 0
  const sy = container?.scrollTop ?? 0
  const snapshot: FlipSnapshot = new Map()
  for (const el of elements) {
    const key = keyOf(el)
    if (key == null) continue
    const r = el.getBoundingClientRect()
    snapshot.set(key, { x: r.left + sx, y: r.top + sy })
  }
  return snapshot
}

/**
 * 記録した位置から今の位置へ補間する。新しく現れた要素は対象外。
 * axis で片方向だけに絞れる (親ごと動く分は親で補間し、子は親の中の移動だけ)。
 * durationToken は追従の速さが要る場面 (ドラッグ中など) で短くするため
 */
export function playFlip(
  snapshot: FlipSnapshot,
  elements: Iterable<HTMLElement>,
  keyOf: (el: HTMLElement) => string | undefined,
  container?: HTMLElement | null,
  axis: 'x' | 'y' | 'both' = 'both',
  durationToken = '--nd-duration-slow',
): void {
  const duration = motionDuration(durationToken, 280)
  if (duration <= 0 || snapshot.size === 0) return
  const easing = motionEasing('--nd-ease-decel')
  const sx = container?.scrollLeft ?? 0
  const sy = container?.scrollTop ?? 0
  for (const el of elements) {
    const key = keyOf(el)
    const first = key == null ? undefined : snapshot.get(key)
    if (!first) continue
    const r = el.getBoundingClientRect()
    const dx = axis === 'y' ? 0 : first.x - (r.left + sx)
    const dy = axis === 'x' ? 0 : first.y - (r.top + sy)
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
      duration,
      easing,
    })
  }
}
