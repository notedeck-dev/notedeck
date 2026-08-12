import { type ComputedRef, computed } from 'vue'
import { mergeThemeUpdate, serializeTheme } from '@/services/selfEditApply'
import { usePluginsStore } from '@/stores/plugins'
import { useSkillsStore } from '@/stores/skills'
import { useThemeStore } from '@/stores/theme'
import { useWidgetsStore } from '@/stores/widgets'
import type { HistoryKind } from '@/utils/settingsFs'

/**
 * 履歴 diff の比較相手になる「現在の内容」を store から読む (#981)。
 *
 * 開いた時点の値をコピーで渡すと、revert / AI 編集のあとに「現在との差分」が
 * 実態とズレる。種別ごとの取り出し方の差だけをここに閉じ込め、履歴ウィンドウ
 * 側は kind で分岐しない。
 */
export function useEditTargetText(
  kind: () => HistoryKind,
  itemId: () => string | undefined,
): ComputedRef<string> {
  const skills = useSkillsStore()
  const widgets = useWidgetsStore()
  const plugins = usePluginsStore()
  const theme = useThemeStore()
  return computed(() => {
    const id = itemId() ?? ''
    switch (kind()) {
      case 'skill':
        return skills.get(id)?.body ?? ''
      case 'widget':
        return widgets.getWidget(id)?.src ?? ''
      case 'plugin':
        return plugins.getPlugin(id)?.src ?? ''
      case 'theme': {
        const t = theme.installedThemes.find((x) => x.id === id)
        return t ? serializeTheme(mergeThemeUpdate(t, {})) : ''
      }
      case 'css':
        return theme.customCss
    }
  })
}
