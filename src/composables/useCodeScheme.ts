import { computed, watchEffect } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { type CodeScheme, setCodeScheme } from '@/utils/highlight'

/**
 * コード面 (エディタ / 差分表示 / コードブロック) の明暗 (#1053)。
 *
 * トークン色は面の明暗とセットでないと読めないので、面・エディタのテーマ・
 * ハイライトのテーマを 1 つの実効値から決める。実効値は root の
 * `data-nd-code-scheme` に出し、CSS 変数側 (global.css) がそれを見る。
 *
 * 設定は 1 つだけ持つ (編集と表示で分けない)。分ける理由が見つからないうちは
 * 項目を増やさない。
 */
export type CodeSchemePreference = 'dark' | 'light' | 'auto'

export function resolveCodeScheme(
  preference: CodeSchemePreference | undefined,
  appIsDark: boolean,
): CodeScheme {
  if (preference === 'dark' || preference === 'light') return preference
  return appIsDark ? 'dark' : 'light'
}

export function useCodeScheme(): void {
  const settingsStore = useSettingsStore()
  const themeStore = useThemeStore()
  const effective = computed(() =>
    resolveCodeScheme(
      settingsStore.get('appearance.codeScheme'),
      themeStore.isCurrentDark(),
    ),
  )
  watchEffect(() => {
    document.documentElement.dataset.ndCodeScheme = effective.value
    setCodeScheme(effective.value)
  })
}
