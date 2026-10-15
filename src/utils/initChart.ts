/**
 * Chart.js のグローバル登録。Activity タブで使う chart 種の controller/element のみ。
 * チャートコンポーネントの冒頭で side-effect import することで遅延登録される。
 *
 * 将来 line / doughnut 等を追加する際は必要な controller/element をここに追記。
 */
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Title,
  Tooltip,
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix'
import gradient from 'chartjs-plugin-gradient'

// ES module は 1 度しか評価されないので、二重登録はモジュールのキャッシュが防ぐ
Chart.register(
  MatrixController,
  MatrixElement,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
  TimeScale,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title,
  gradient,
)
Chart.defaults.animation = false

/**
 * Misskey 本家 MkHeatmap.vue の固定ブランドカラーに合わせる
 * (テーマ CSS 変数ではない、本家と同じ固定値)。
 */
export function getHeatmapColor(isDark: boolean): string {
  return isDark ? '#b4e900' : '#86b300'
}

/**
 * #RRGGBB (または #RGB) を rgba(r, g, b, a) に変換する。Misskey の alpha() 相当。
 */
export function applyAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '')
  const h =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
