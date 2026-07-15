import {
  type InjectionKey,
  inject,
  onScopeDispose,
  provide,
  type Ref,
  ref,
  watchEffect,
} from 'vue'

export interface WindowExternalLink {
  url: string
  /** title 属性。省略時は 'Web UIで開く' */
  title?: string
  /** tabler アイコン名 (ti- 接頭辞なし)。省略時は 'world' */
  icon?: string
  disabled?: boolean
}

export const WINDOW_EXTERNAL_LINK_KEY: InjectionKey<
  Ref<WindowExternalLink | null>
> = Symbol('windowExternalLink')

/** DeckWindow 側で provide する。戻り値を読んでヘッダーボタンを描画する。 */
export function provideWindowExternalLink() {
  const target = ref<WindowExternalLink | null>(null)
  provide(WINDOW_EXTERNAL_LINK_KEY, target)
  return target
}

/**
 * Content コンポーネントから「外部ブラウザで開く」ターゲット URL を登録する。
 * `source` は ref/computed またはプレーン関数。未登録状態に戻すときは null を返す。
 * スコープ破棄時に自動で登録解除される。
 */
export function useWindowExternalLink(
  source: (() => WindowExternalLink | null) | Ref<WindowExternalLink | null>,
) {
  const target = inject(WINDOW_EXTERNAL_LINK_KEY, null)
  if (!target) return
  watchEffect(() => {
    target.value = typeof source === 'function' ? source() : source.value
  })
  onScopeDispose(() => {
    target.value = null
  })
}
