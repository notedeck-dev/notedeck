import { computed, onScopeDispose, ref } from 'vue'

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
 */
export function useNavbarResize() {
  const isNarrowViewport = () =>
    document.documentElement.clientWidth <= NARROW_VIEWPORT

  const preferredWidth = ref(DEFAULT_WIDTH)
  const navWidth = ref(isNarrowViewport() ? MIN_WIDTH : DEFAULT_WIDTH)
  const isResizing = ref(false)
  const navCollapsed = computed(() => navWidth.value <= MIN_WIDTH)

  /** ユーザー操作による幅変更 (トグル・ドラッグ) */
  function setNavWidth(w: number) {
    navWidth.value = w
    preferredWidth.value = w
  }

  function toggleNav() {
    setNavWidth(navCollapsed.value ? DEFAULT_WIDTH : MIN_WIDTH)
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
    setNavWidth,
    toggleNav,
    handleResize,
    startResize,
  }
}
