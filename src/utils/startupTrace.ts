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
 *
 * 表示面は 2 つ: dev コンソールの 1 行サマリ (logStartupSummary) と、
 * About ウィンドウの起動パフォーマンスセクション (getStartupEntries /
 * getWebviewFixedCost)。prod では console が落ちるため後者が唯一の面。
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

/** 記録済みの計測点 (navigation 起点 ms) を時刻順で返す */
export function getStartupEntries(): { name: string; at: number }[] {
  return [...marks.entries()]
    .map(([name, at]) => ({ name, at }))
    .sort((a, b) => a.at - b.at)
}

/**
 * WebView 起動固定費 (プロセス起動 → navigation 開始) の ms。
 * リロードでは timeOrigin だけが更新され、注入されたプロセス起動時刻との
 * 差が「プロセス起動からの経過時間」という無意味な値になるため、
 * 初回ナビゲーション以外は null。
 */
export function getWebviewFixedCost(): number | null {
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  if (nav?.type !== 'navigate' || !window.__ND_PROCESS_START__) return null
  return Math.round(performance.timeOrigin - window.__ND_PROCESS_START__)
}

/** deck 表示到達時に 1 回だけ呼ぶ。dev ではコンソールにサマリを出す */
export function logStartupSummary(): void {
  if (!import.meta.env.DEV) return
  const webviewFixedCost = getWebviewFixedCost()
  const points = getStartupEntries()
    .map(({ name, at }) => `${name}=${Math.round(at)}ms`)
    .join(' ')
  console.info(
    `[startup] ${points}${webviewFixedCost !== null ? ` (webview 起動固定費 ~${webviewFixedCost}ms)` : ''}`,
  )
}
