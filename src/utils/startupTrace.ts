/**
 * 起動クリティカルパスの計測点 (#985、#732 の最小形)。
 *
 * boot script → main.ts 評価 → settings await → mount → window.show →
 * deck mount の各点を performance.mark で記録し、deck 表示到達時に
 * 1 行のサマリを出す。P1 縮小版 (settings command の async 化等) や
 * P3 縮小版 (カラム接続の段階化) の採否は、この実測値を根拠に判断する。
 *
 * Rust プロセス起動からの端到端は、js_init_script で注入される
 * `__ND_PROCESS_START__` (epoch ms) と performance.timeOrigin の差で
 * WebView 起動固定費として補完する (#985 で issue が見落としていた支配項)。
 */

declare global {
  interface Window {
    __ND_PROCESS_START__?: number
  }
}

const marks = new Map<string, number>()

/** 計測点を記録する。同名の再呼び出しは初回優先で無視 */
export function markStartup(name: string): void {
  if (marks.has(name)) return
  marks.set(name, performance.now())
  performance.mark(`nd:startup:${name}`)
}

/** deck 表示到達時に 1 回だけ呼ぶ。dev ではコンソールにサマリを出す */
export function logStartupSummary(): void {
  if (!import.meta.env.DEV) return
  const webviewFixedCost = window.__ND_PROCESS_START__
    ? Math.round(performance.timeOrigin - window.__ND_PROCESS_START__)
    : null
  const points = [...marks.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([name, t]) => `${name}=${Math.round(t)}ms`)
    .join(' ')
  console.info(
    `[startup] ${points}${webviewFixedCost !== null ? ` (webview 起動固定費 ~${webviewFixedCost}ms)` : ''}`,
  )
}
