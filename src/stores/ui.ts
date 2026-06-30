import { type Platform, platform } from '@tauri-apps/plugin-os'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

export function detectPlatformFromUserAgent(
  userAgent: string,
): Platform | null {
  if (/android/i.test(userAgent)) return 'android'
  if (/(iphone|ipad|ipod)/i.test(userAgent)) return 'ios'
  if (/windows/i.test(userAgent)) return 'windows'
  if (/(macintosh|mac os x)/i.test(userAgent)) return 'macos'
  if (/linux/i.test(userAgent)) return 'linux'
  return null
}

function resolvePlatformName(): Platform | null {
  if (isTauri) {
    try {
      return platform()
    } catch {
      // Fallback to user agent if Tauri os plugin internals are unavailable.
    }
  }
  return detectPlatformFromUserAgent(navigator.userAgent)
}

const platformName = resolvePlatformName()
const isMobilePlatform = platformName === 'android' || platformName === 'ios'
const isDesktop = isTauri && !isMobilePlatform

const MOBILE_BREAKPOINT = 420 // 420px 以下をモバイルとみなす（タブレット横持ち等は除外）

export const useUiStore = defineStore('ui', () => {
  const sidebarOpen = ref(true)

  // モバイル (compact) のナビバードロワー開閉。DeckLayout が所有していたが、
  // チュートリアル等が programmatic に開けるよう store に移管 (横断 UI 状態)。
  const mobileDrawerOpen = ref(false)

  const hasWindow = typeof window !== 'undefined'
  const isNarrowViewport = ref(
    hasWindow && window.innerWidth <= MOBILE_BREAKPOINT,
  )
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  const onResize = () => {
    if (resizeTimer) return
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      isNarrowViewport.value = window.innerWidth <= MOBILE_BREAKPOINT
    }, 100)
  }
  if (hasWindow) {
    window.addEventListener('resize', onResize)
    onScopeDispose(() => {
      window.removeEventListener('resize', onResize)
      if (resizeTimer) clearTimeout(resizeTimer)
    })
  }

  /** ビューポート幅ベースのレイアウト判定（タブレット横持ち等では false） */
  const isCompactLayout = computed(() => isNarrowViewport.value)

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
  }

  // --- Reactive signals (replaces window.dispatchEvent event bus) ---

  /** Incremented on deck resume (visibility change, offline→online). Watch to react. */
  const deckResumeSignal = ref(0)
  function emitDeckResume() {
    deckResumeSignal.value++
  }

  /** Set to true when DeckLayout DOM is mounted (used to dismiss splash). */
  const deckMounted = ref(false)

  /** Incremented when drive files change. Carries accountId. */
  const driveFilesChanged = ref<{ accountId: string; ts: number }>({
    accountId: '',
    ts: 0,
  })
  function emitDriveFilesChanged(accountId: string) {
    driveFilesChanged.value = { accountId, ts: Date.now() }
  }

  return {
    isTauri,
    isDesktop,
    isCompactLayout,
    isMobilePlatform,
    platformName,
    sidebarOpen,
    mobileDrawerOpen,
    toggleSidebar,
    deckResumeSignal,
    emitDeckResume,
    deckMounted,
    driveFilesChanged,
    emitDriveFilesChanged,
  }
})

/** isCompactLayout を reactive に取得するヘルパー */
export function useIsCompactLayout() {
  const { isCompactLayout } = storeToRefs(useUiStore())
  return isCompactLayout
}
