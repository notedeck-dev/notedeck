import { computed, watchEffect } from 'vue'
import { useThemeStore } from '@/stores/theme'

export type CodeScheme = 'dark' | 'light'

/**
 * コード面 (エディタ / 差分表示 / コードブロック) の明暗 (#1053)。
 *
 * トークン色は面の明暗とセットでないと読めないので、面・エディタ・読み取り側
 * (Shiki) の色を 1 つの実効値から決める。実効値は root の `data-nd-code-scheme`
 * に出し、CSS 変数側 (global.css) がそれを見る。エディタも Shiki も色は変数
 * 経由なので、切替で作り直し・再描画はしない (#1050)。
 *
 * 設定項目は持たない。アプリのテーマにそのまま追従する (アプリが OS 追従なら
 * コード面も OS に追従する)。触れば分かる挙動で完結するものに設定を増やさない
 * 方針で、明暗を別扱いしたい場合はカスタム CSS で変数を上書きできる。
 */
export function useCodeScheme(): void {
  const themeStore = useThemeStore()
  const effective = computed<CodeScheme>(() =>
    themeStore.isCurrentDark() ? 'dark' : 'light',
  )
  watchEffect(() => {
    document.documentElement.dataset.ndCodeScheme = effective.value
  })
}
