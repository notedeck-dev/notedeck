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
