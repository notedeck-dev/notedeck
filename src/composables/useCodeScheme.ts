import { computed, watchEffect } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { type CodeScheme, setCodeScheme } from '@/utils/highlight'

/**
 * コード面 (エディタ / 差分表示 / コードブロック) の明暗 (#1053)。
 *
 * トークン色は面の明暗とセットでないと読めないので、面・エディタのテーマ・
 * ハイライトのテーマを 1 つの実効値から決める。実効値は root の
 * `data-nd-code-scheme` に出し、CSS 変数側 (global.css) がそれを見る。
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
    setCodeScheme(effective.value)
  })
}
