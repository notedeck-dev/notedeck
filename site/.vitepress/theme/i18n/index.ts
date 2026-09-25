import { useData } from 'vitepress'
import { computed } from 'vue'
import en from './en'
import ja, { type Messages } from './ja'

// キーは config.mts の locales と同じ。root (= ja) 以外は URL の接頭辞にもなる
const MESSAGES: Record<string, Messages> = { root: ja, en }

/**
 * theme の文言と、今の言語でのサイト内パス。vue-i18n は入れない (#1145)。
 * VitePress が URL から決めた localeIndex をそのまま使う。
 */
export function useI18n() {
  const { localeIndex } = useData()
  const t = computed(() => MESSAGES[localeIndex.value] ?? ja)
  /** `/docs/` → en なら `/en/docs/`。root はそのまま */
  const localePath = (path: string) =>
    localeIndex.value === 'root' ? path : `/${localeIndex.value}${path}`
  return { t, localePath }
}
