// JS 側から動きを付けるときの共通判定。CSS の `@media (prefers-reduced-motion)`
// (global.css) は CSS アニメにしか効かないので、WAAPI / scrollTo の
// behavior / leave 遅延のタイマーはここを通して reduced-motion に従わせる。
// 時間と easing は global.css の motion トークンを読み、JS に値を複製しない。

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** 視差効果を減らす設定か (呼ぶたびに現在値を読む) */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  )
}

/** scrollTo / scrollIntoView に渡す behavior。reduced-motion では瞬時 */
export function smoothScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'instant' : 'smooth'
}

/** `0.28s` / `150ms` をミリ秒にする。解釈できなければ fallback */
export function parseCssDuration(value: string, fallback = 0): number {
  const v = value.trim()
  const m = /^(-?[\d.]+)(ms|s)$/.exec(v)
  if (!m) return fallback
  const n = Number(m[1])
  if (!Number.isFinite(n)) return fallback
  return m[2] === 's' ? n * 1000 : n
}

/** motion トークン (`--nd-duration-*`) をミリ秒で読む。reduced-motion では 0 */
export function motionDuration(token: string, fallback: number): number {
  if (prefersReducedMotion()) return 0
  if (typeof document === 'undefined') return fallback
  return parseCssDuration(
    getComputedStyle(document.documentElement).getPropertyValue(token),
    fallback,
  )
}

/** easing トークン (`--nd-ease-*`) を読む。WAAPI の easing は var() を解決しない */
export function motionEasing(token: string, fallback = 'ease-out'): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim()
  return v || fallback
}

/**
 * 要素 (と子孫) で走っている有限のアニメーションが終わるまで待つ。退場アニメの
 * 後で DOM を外す / hidePopover / close するときに使う。固定ミリ秒のタイマー
 * だと CSS 側の時間とずれて、途中で切れたり透明なまま残ってクリックを
 * 吸ったりする。無限のアニメ (スピナー等) は待たず、timeoutMs で打ち切る
 */
export async function waitForAnimations(
  el: Element,
  timeoutMs = 1000,
): Promise<void> {
  if (prefersReducedMotion() || typeof el.getAnimations !== 'function') return
  const running = el.getAnimations({ subtree: true }).filter((a) => {
    const timing = a.effect?.getComputedTiming()
    return timing != null && timing.iterations !== Number.POSITIVE_INFINITY
  })
  if (running.length === 0) return
  await Promise.race([
    Promise.allSettled(running.map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

/**
 * スクロール領域を先頭へ戻す。遠いところから smooth で戻ると時間がかかり、
 * 仮想スクローラでは途中の再測定で着地がずれてカクつく。1 画面分の手前まで
 * 瞬時に寄せてから、残りだけ滑らかに戻す
 */
export function scrollToTopSmart(el: HTMLElement | null | undefined): void {
  if (!el) return
  const behavior = smoothScrollBehavior()
  if (behavior === 'smooth' && el.scrollTop > el.clientHeight * 1.5) {
    el.scrollTop = el.clientHeight
  }
  el.scrollTo({ top: 0, behavior })
}

/** 減速カーブ (ease-out cubic)。--nd-ease-decel に近い手触り */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

const scrollAnimations = new WeakMap<HTMLElement, number>()

/**
 * 横スクロールを指定の時間で目標へ動かす。ブラウザの smooth スクロールは
 * 速さを指定できず、カラム 1 本ぶんの移動でももたついて見えるので自前で補間する。
 * scroll-snap が掛かっている領域は、途中の位置を書くたびに吸着してしまうため、
 * 動かしている間だけ吸着を外し、着いたら元に戻す。同じ要素で次のアニメーションが
 * 始まったら前のものは止める
 */
export function animateScrollLeft(
  el: HTMLElement,
  left: number,
  durationMs: number,
): Promise<void> {
  const prevFrame = scrollAnimations.get(el)
  if (prevFrame != null) cancelAnimationFrame(prevFrame)
  const from = el.scrollLeft
  if (durationMs <= 0 || Math.abs(left - from) < 1) {
    el.scrollLeft = left
    scrollAnimations.delete(el)
    return Promise.resolve()
  }
  const snap = el.dataset.ndSnapType ?? el.style.scrollSnapType
  el.dataset.ndSnapType = snap
  el.style.scrollSnapType = 'none'
  const start = performance.now()
  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      el.scrollLeft = from + (left - from) * easeOutCubic(t)
      if (t < 1) {
        scrollAnimations.set(el, requestAnimationFrame(step))
        return
      }
      scrollAnimations.delete(el)
      el.style.scrollSnapType = snap
      delete el.dataset.ndSnapType
      resolve()
    }
    scrollAnimations.set(el, requestAnimationFrame(step))
  })
}
