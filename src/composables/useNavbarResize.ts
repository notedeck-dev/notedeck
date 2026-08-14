import { computed, onScopeDispose, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// 幅は本家 Misskey のデッキ UI に合わせる (#1045)。
// MIN_WIDTH = navbar の --nav-icon-only-width / DEFAULT_WIDTH = --nav-width。
// ドラッグでのリサイズと上限は NoteDeck 固有 (本家は設定でのトグルのみ)
const MIN_WIDTH = 80
const COLLAPSE_THRESHOLD = 140
const DEFAULT_WIDTH = 250
const MAX_WIDTH = 400
/** これ以下のビューポート幅では畳んだ状態を強制する */
const NARROW_VIEWPORT = 1279

/**
 * ナビバーの幅・折りたたみ状態。
 *
 * ビューポートが狭いあいだは畳むが、ユーザーが選んだ幅は `preferredWidth` に
 * 残して広くなったら復元する。以前はビューポートが広がるたびに既定幅へ戻して
 * いたため、スマホサイズ表示との往復で自分で畳んだ状態が外れていた (#1069)。
 *
 * `preferredWidth` は settings.json5 の `deck.navWidth` に永続化する。書き戻す
 * のはユーザー操作が確定した時点 (トグル・ドラッグ終了) だけで、ドラッグ中の
 * 途中経過は書かない (settings を参照している画面全体が再評価されるため)。
 */
export function useNavbarResize() {
  const settingsStore = useSettingsStore()

  const isNarrowViewport = () =>
    document.documentElement.clientWidth <= NARROW_VIEWPORT

  const preferredWidth = ref(loadPreferredWidth())
  const navWidth = ref(isNarrowViewport() ? MIN_WIDTH : preferredWidth.value)
  const isResizing = ref(false)
  const navCollapsed = computed(() => navWidth.value <= MIN_WIDTH)

  /** 直接編集された settings.json5 も想定して許容範囲に丸める */
  function loadPreferredWidth(): number {
    const saved = settingsStore.get('deck.navWidth')
    if (typeof saved !== 'number' || !Number.isFinite(saved)) {
      return DEFAULT_WIDTH
    }
    return Math.min(Math.max(saved, MIN_WIDTH), MAX_WIDTH)
  }

  function setNavWidth(w: number) {
    navWidth.value = w
    preferredWidth.value = w
  }

  function persistNavWidth() {
    settingsStore.set('deck.navWidth', preferredWidth.value)
  }

  function toggleNav() {
    setNavWidth(navCollapsed.value ? DEFAULT_WIDTH : MIN_WIDTH)
    persistNavWidth()
  }

  /** ウィンドウリサイズ時。ユーザーが選んだ幅は書き換えない */
  function handleResize() {
    navWidth.value = isNarrowViewport() ? MIN_WIDTH : preferredWidth.value
  }

  let resizeRafId = 0
  function onResize(e: PointerEvent) {
    cancelAnimationFrame(resizeRafId)
    resizeRafId = requestAnimationFrame(() => {
      const w = e.clientX
      setNavWidth(w <= COLLAPSE_THRESHOLD ? MIN_WIDTH : Math.min(w, MAX_WIDTH))
    })
  }

  function stopResize() {
    isResizing.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    document.removeEventListener('pointermove', onResize)
    document.removeEventListener('pointerup', stopResize)
    document.removeEventListener('pointercancel', stopResize)
    persistNavWidth()
  }

  function startResize(e: PointerEvent) {
    e.preventDefault()
    isResizing.value = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('pointermove', onResize)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
  }

  onScopeDispose(() => {
    if (isResizing.value) stopResize()
  })

  return {
    navWidth,
    navCollapsed,
    isResizing,
    toggleNav,
    handleResize,
    startResize,
  }
}
