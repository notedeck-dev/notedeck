/**
 * タブ列のキーボード操作 (WAI-ARIA の tablist)。左右キーで隣のタブ、Home / End で
 * 端へ移る。端では反対側へ回る。移らないキーは null
 */
export function nextTabValue<T>(
  values: readonly T[],
  current: T,
  key: string,
): T | null {
  if (values.length === 0) return null
  const i = Math.max(0, values.indexOf(current))
  const n = values.length
  switch (key) {
    case 'ArrowRight':
      return values[(i + 1) % n] ?? null
    case 'ArrowLeft':
      return values[(i - 1 + n) % n] ?? null
    case 'Home':
      return values[0] ?? null
    case 'End':
      return values[n - 1] ?? null
    default:
      return null
  }
}
