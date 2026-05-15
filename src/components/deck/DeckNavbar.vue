<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  toRef,
  useCssModule,
  watch,
} from 'vue'
import { useCommandStore } from '@/commands/registry'
import ColumnBadges from '@/components/common/ColumnBadges.vue'
import { useAccountActions } from '@/composables/useAccountActions'
import { useColumnBadge } from '@/composables/useColumnBadge'
import { COLUMN_ICONS, COLUMN_LABELS } from '@/composables/useColumnTabs'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNavigation } from '@/composables/useNavigation'
import { navbarTargetId, useSpotlightStore } from '@/composables/useSpotlight'
import { useVaporTransition } from '@/composables/useVaporTransition'
import {
  type Account,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { isNavDivider, type NavItem, useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useServersStore } from '@/stores/servers'
import { useStreamingStore } from '@/stores/streaming'
import { useIsCompactLayout } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import {
  clearAvailableTlCache,
  detectAvailableTimelines,
} from '@/utils/customTimelines'
import { AppError } from '@/utils/errors'
import { hapticLight, hapticMedium } from '@/utils/haptics'
import { proxyThumbUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckLaunchPad from './DeckLaunchPad.vue'
import DeckProfileMenu from './DeckProfileMenu.vue'
import DeckSettingsMenu from './DeckSettingsMenu.vue'
import LogoutDialog from './LogoutDialog.vue'
import NavAccountMenu from './NavAccountMenu.vue'

const props = defineProps<{
  mobileDrawerOpen: boolean
  showProfileMenu: boolean
  showSettingsMenu: boolean
  updateAvailable: boolean
}>()

const emit = defineEmits<{
  'open-compose': []
  'update:mobileDrawerOpen': [value: boolean]
  'update:showProfileMenu': [value: boolean]
  'update:showSettingsMenu': [value: boolean]
}>()

const $style = useCssModule()
const { navigateToLogin } = useNavigation()
const accountActions = useAccountActions()
const { confirm } = useConfirm()
const commandStore = useCommandStore()
const deckStore = useDeckStore()
const offlineModeStore = useOfflineModeStore()
const realtimeModeStore = useRealtimeModeStore()
const windowsStore = useWindowsStore()
const isCompact = useIsCompactLayout()
const { getBadge, clearBadge } = useColumnBadge()
const spotlightStore = useSpotlightStore()

function isNavSpotlighted(item: NavItem): boolean {
  if (isNavDivider(item)) return false
  return spotlightStore.spotlights.has(
    navbarTargetId(item.type, item.accountId),
  )
}

const accountAttentionCount = computed(
  () =>
    accountsStore.accounts.filter((a) => !a.hasToken && !isGuestAccount(a))
      .length,
)

async function toggleOfflineMode() {
  const isOn = offlineModeStore.isOfflineMode
  const ok = await confirm({
    title: isOn ? 'オフラインモードを解除' : 'オフラインモードに切替',
    message: isOn
      ? 'サーバーに再接続します。'
      : 'すべての通信を停止し、キャッシュ済みデータのみ表示します。',
    okLabel: isOn ? '解除' : '切替',
    cancelLabel: 'キャンセル',
    type: 'question',
  })
  if (ok) await offlineModeStore.toggle()
}

async function toggleRealtimeMode() {
  const isRealtime = realtimeModeStore.isRealtime
  const ok = await confirm({
    title: isRealtime ? 'ポーリングモードに切替' : 'リアルタイムモードに切替',
    message: isRealtime
      ? 'WebSocket接続を切断し、定期的なHTTPポーリングに切り替えます。'
      : 'リアルタイム更新に切り替えます。',
    okLabel: '切替',
    cancelLabel: 'キャンセル',
    type: 'question',
  })
  if (ok) realtimeModeStore.toggle()
}

const sidebarType = computed(() => {
  const col = deckStore.columns.find((c) => c.sidebar)
  return col?.type ?? null
})

function navIcon(type: string): string {
  return `ti-${COLUMN_ICONS[type] ?? 'layout-grid'}`
}

function navLabel(item: NavItem): string {
  if (isNavDivider(item)) return ''
  return item.label || COLUMN_LABELS[item.type] || item.type
}

function getNavAction(item: NavItem): () => void {
  if (isNavDivider(item))
    return () => {
      /* divider has no action */
    }
  return () => {
    // spotlight 中のボタンをユーザーがクリック = 認識した。即 clear
    spotlightStore.clear(navbarTargetId(item.type, item.accountId))
    clearBadge(item.type)
    deckStore.toggleSidebarColumn(item.type, item.accountId, {
      ...item.columnProps,
      ...(item.label ? { name: item.label } : {}),
    })
  }
}

function getNavBadge(item: NavItem): number {
  if (isNavDivider(item)) return 0
  return getBadge(item.type)
}

function closeDrawerAndDo(fn: () => void) {
  emit('update:mobileDrawerOpen', false)
  nextTick(fn)
}
const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const streamingStore = useStreamingStore()

function getServerIconUrl(host: string): string | undefined {
  const url =
    serversStore.getServer(host)?.iconUrl || `https://${host}/favicon.ico`
  return proxyThumbUrl(url, 28)
}

watch(
  () => accountsStore.accounts.length,
  () => {
    for (const acc of accountsStore.accounts) {
      if (acc.hasToken) {
        streamingStore.fetchOnlineStatus(acc.id, acc.userId)
      } else {
        streamingStore.disconnect(acc.id)
      }
    }
  },
  { immediate: true },
)

const statusClassMap: Record<string, string> = {
  online: $style.statusOnline,
  active: $style.statusActive,
  offline: $style.statusOffline,
  unknown: $style.statusUnknown,
}

function onlineStatusClass(accountId: string): string | undefined {
  return statusClassMap[streamingStore.getState(accountId)]
}

// Navbar resize
const MIN_WIDTH = 56
const COLLAPSE_THRESHOLD = 120
const DEFAULT_WIDTH = 220
const MAX_WIDTH = 400
const navWidth = ref(
  document.documentElement.clientWidth <= 1279 ? MIN_WIDTH : DEFAULT_WIDTH,
)
const isResizing = ref(false)
const subButtonsHovered = ref(false)
const navCollapsed = computed(() => navWidth.value <= MIN_WIDTH)
watch(
  navCollapsed,
  (v) => {
    deckStore.navCollapsed = v
  },
  { immediate: true },
)

function toggleNav() {
  navWidth.value = navCollapsed.value ? DEFAULT_WIDTH : MIN_WIDTH
}

// Launch pad ("もっと")
const showLaunchPad = ref(false)
const launchPadAnchor = ref<{ x: number; y: number } | null>(null)

function openLaunchPad(e: MouseEvent) {
  if (!isCompact.value) {
    const btn = e.currentTarget as HTMLElement
    const btnRect = btn.getBoundingClientRect()
    const navRect = btn.closest('nav')?.getBoundingClientRect() ?? btnRect
    launchPadAnchor.value = {
      x: navRect.right + 8,
      y: btnRect.top + btnRect.height / 2,
    }
  } else {
    launchPadAnchor.value = null
  }
  closeDrawerAndDo(() => {
    showLaunchPad.value = true
  })
}

function toggleProfileMenu() {
  if (props.showProfileMenu) {
    emit('update:showProfileMenu', false)
  } else {
    closeDrawerAndDo(() => emit('update:showProfileMenu', true))
  }
}

function toggleSettingsMenu() {
  if (props.showSettingsMenu) {
    emit('update:showSettingsMenu', false)
  } else {
    closeDrawerAndDo(() => emit('update:showSettingsMenu', true))
  }
}

// Account menu
const accountMenuId = ref<string | null>(null)
const showAccountPopup = ref(false)
const accountDialogRef = ref<HTMLDialogElement | null>(null)
const { visible: accountPopupVisible, leaving: accountPopupLeaving } =
  useVaporTransition(toRef(showAccountPopup), {
    enterDuration: 200,
    leaveDuration: 200,
  })

useNativeDialog(
  accountDialogRef,
  computed(() => accountPopupVisible.value && isCompact.value),
  {
    onCancel: () => {
      showAccountPopup.value = false
      accountMenuId.value = null
    },
    leaveDuration: 200,
  },
)

function toggleAccountPopup() {
  if (showAccountPopup.value) {
    showAccountPopup.value = false
    accountMenuId.value = null
  } else {
    closeDrawerAndDo(() => {
      showAccountPopup.value = true
      accountMenuId.value = null
    })
  }
}
const selectedAccount = computed(() =>
  accountsStore.accounts.find((a) => a.id === accountMenuId.value),
)
const accountModes = ref<Record<string, Record<string, boolean>>>({})
const accountIsAdmin = ref<Record<string, boolean>>({})
const togglingMode = ref(false)
const modeError = ref<string | null>(null)

function toggleAccountMenu(id: string) {
  if (accountMenuId.value === id) {
    accountMenuId.value = null
    return
  }
  accountMenuId.value = id
  modeError.value = null
  loadAccountModes(id)
}

function onDocumentClick() {
  if (showAccountPopup.value) {
    showAccountPopup.value = false
    accountMenuId.value = null
    return
  }
  accountMenuId.value = null
}

document.addEventListener('click', onDocumentClick)
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

async function loadAccountModes(id: string) {
  try {
    const result = await detectAvailableTimelines(id)
    accountModes.value = { ...accountModes.value, [id]: result.modes }
  } catch {
    // non-critical
  }
  try {
    const me = unwrap(await commands.apiGetSelf(id)) as Record<string, unknown>
    accountIsAdmin.value = {
      ...accountIsAdmin.value,
      [id]: me.isAdmin === true || me.isModerator === true,
    }
  } catch {
    // non-critical
  }
}

async function toggleAccountMode(accountId: string, key: string) {
  togglingMode.value = true
  modeError.value = null
  try {
    const modes = accountModes.value[accountId] ?? {}
    const newValue = !modes[key]
    unwrap(await commands.apiUpdateUserSetting(accountId, key, newValue))
    accountModes.value = {
      ...accountModes.value,
      [accountId]: { ...modes, [key]: newValue },
    }
    clearAvailableTlCache(accountId)
    accountsStore.bumpModeVersion(accountId)
  } catch (e) {
    const err = AppError.from(e)
    if (err.isAuth || String(err.message).includes('permission')) {
      modeError.value =
        '権限がありません。write:account の権限を付与するために再ログインしてください。'
    } else {
      modeError.value = err.message
    }
  } finally {
    togglingMode.value = false
  }
}

const logoutTargetId = ref<string | null>(null)

function showLogoutDialog(id: string) {
  logoutTargetId.value = id
  accountMenuId.value = null
}

function logoutKeepData() {
  if (!logoutTargetId.value) return
  const acc = accountsStore.accountMap.get(logoutTargetId.value)
  if (acc) accountActions.logoutKeepData(acc)
  logoutTargetId.value = null
}

function logoutDeleteAll() {
  if (!logoutTargetId.value) return
  const acc = accountsStore.accountMap.get(logoutTargetId.value)
  if (acc) accountActions.deleteAccountData(acc)
  logoutTargetId.value = null
}

async function clearAccountCache(accountId: string) {
  const acc = accountsStore.accountMap.get(accountId)
  if (!acc) return
  const ok = await confirm({
    title: 'キャッシュ削除',
    message: `${getAccountLabel(acc)} のキャッシュを削除しますか？`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  unwrap(await commands.clearAccountCache(accountId))
}

function toggleFirstAccountMenu() {
  if (!isCompact.value) {
    commandStore.execute('account-menu')
    return
  }
  showAccountPopup.value = !showAccountPopup.value
  if (!showAccountPopup.value) accountMenuId.value = null
}

function handleResize() {
  if (document.documentElement.clientWidth <= 1279) {
    navWidth.value = MIN_WIDTH
  } else if (navWidth.value <= MIN_WIDTH) {
    navWidth.value = DEFAULT_WIDTH
  }
}

// Navbar drag resize
function startResize(e: PointerEvent) {
  e.preventDefault()
  isResizing.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  document.addEventListener('pointermove', onResize)
  document.addEventListener('pointerup', stopResize)
  document.addEventListener('pointercancel', stopResize)
}

let resizeRafId = 0
function onResize(e: PointerEvent) {
  cancelAnimationFrame(resizeRafId)
  resizeRafId = requestAnimationFrame(() => {
    const w = e.clientX
    if (w <= COLLAPSE_THRESHOLD) {
      navWidth.value = MIN_WIDTH
    } else {
      navWidth.value = Math.min(w, MAX_WIDTH)
    }
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

defineExpose({
  toggleNav,
  toggleFirstAccountMenu,
  handleResize,
  navWidth,
})
</script>

<template>
  <div :class="$style.wrapper">
    <nav
      :class="[
        $style.navbar,
        {
          [$style.drawerMode]: isCompact,
          [$style.drawerOpen]: props.mobileDrawerOpen,
        },
      ]"
      :style="isCompact ? undefined : { flexBasis: navWidth + 'px' }"
    >
      <div :class="$style.body">
        <!-- Top header -->
        <div :class="$style.top">
          <button
            class="_button"
            :class="$style.instanceBtn"
            title="NoteDeck について"
            @click="windowsStore.open('about')"
          >
            <img src="/favicon.svg" :class="$style.instanceIcon" alt="NoteDeck" />
            <span v-if="props.updateAvailable" :class="$style.updateDot" />
          </button>
          <button
            v-if="!navCollapsed || isCompact"
            class="_button"
            :class="[$style.topBtn, offlineModeStore.isOfflineMode ? $style.offlineActive : $style.onlineActive]"
            :title="offlineModeStore.isOfflineMode ? 'オンラインモードに切り替え' : 'オフラインモードに切り替え'"
            @click="hapticLight(); toggleOfflineMode()"
          >
            <i :class="offlineModeStore.isOfflineMode ? 'ti ti-wifi-off' : 'ti ti-wifi'" />
          </button>
          <button
            v-if="!navCollapsed || isCompact"
            class="_button"
            :class="[$style.topBtn, realtimeModeStore.enabled ? $style.realtimeActive : $style.pollingActive, { [$style.itemDisabled]: offlineModeStore.isOfflineMode }]"
            :disabled="offlineModeStore.isOfflineMode"
            :title="realtimeModeStore.enabled ? 'ポーリングモードに切り替え' : 'リアルタイムモードに切り替え'"
            @click="hapticLight(); toggleRealtimeMode()"
          >
            <i :class="realtimeModeStore.enabled ? 'ti ti-bolt' : 'ti ti-bolt-off'" />
          </button>
        </div>

        <!-- Nav items (scrollable) -->
        <div :class="$style.topScroll">
          <div :class="$style.section">
            <template v-for="(navItem, navIdx) in deckStore.navItems" :key="navIdx">
              <div v-if="isNavDivider(navItem)" :class="$style.divider" />
              <button
                v-else
                class="_button"
                :class="[
                  $style.item,
                  { [$style.sidebarActive]: sidebarType === navItem.type },
                  isNavSpotlighted(navItem) && $style.spotlighted,
                ]"
                :title="navLabel(navItem)"
                @click="hapticLight(); closeDrawerAndDo(getNavAction(navItem))"
              >
                <div :class="$style.iconWrap">
                  <i :class="['ti', navIcon(navItem.type)]" />
                  <span v-if="getNavBadge(navItem) > 0" :key="getNavBadge(navItem)" :class="$style.badge">{{ getNavBadge(navItem) > 99 ? '99+' : getNavBadge(navItem) }}</span>
                  <ColumnBadges :account-id="navItem.accountId" />
                </div>
                <span :class="$style.label">{{ navLabel(navItem) }}</span>
              </button>
            </template>
            <button
              v-if="!isCompact"
              class="_button"
              :class="$style.item"
              title="もっと"
              @click="hapticLight(); openLaunchPad($event)"
            >
              <div :class="$style.iconWrap">
                <i class="ti ti-grid-dots" />
              </div>
              <span :class="$style.label">もっと</span>
            </button>
          </div>
        </div>

        <!-- Bottom fixed section: buttons -->
        <div :class="[$style.section, $style.bottomSection]">
          <!-- Mobile-only: more, profile & settings -->
          <div v-if="isCompact" :class="$style.mobileOnly">
            <button
              class="_button"
              :class="$style.item"
              title="もっと"
              @click="hapticLight(); openLaunchPad($event)"
            >
              <i class="ti ti-grid-dots" />
              <span :class="$style.label">もっと</span>
            </button>
            <div :class="$style.menuWrap">
              <button
                class="_button"
                :class="$style.item"
                title="プロファイル"
                @pointerdown.stop
                @click.stop="toggleProfileMenu()"
              >
                <i class="ti ti-layout" />
                <span :class="$style.label">プロファイル</span>
              </button>
              <DeckProfileMenu :show="props.showProfileMenu" @close="emit('update:showProfileMenu', false)" />
            </div>
            <div :class="$style.menuWrap">
              <button
                class="_button"
                :class="$style.item"
                title="設定"
                @pointerdown.stop
                @click.stop="toggleSettingsMenu()"
              >
                <i class="ti ti-settings" />
                <span :class="$style.label">設定</span>
              </button>
              <DeckSettingsMenu :show="props.showSettingsMenu" @close="emit('update:showSettingsMenu', false)" />
            </div>
          </div>
          <div v-if="isCompact" :class="$style.divider" />

          <!-- Offline/Realtime mode (collapsed desktop only) -->
          <template v-if="navCollapsed && !isCompact">
            <button
              class="_button"
              :class="[$style.item, offlineModeStore.isOfflineMode ? $style.offlineActive : $style.onlineActive]"
              :title="offlineModeStore.isOfflineMode ? 'オンラインモードに切り替え' : 'オフラインモードに切り替え'"
              @click="hapticLight(); toggleOfflineMode()"
            >
              <div :class="$style.iconWrap">
                <i :class="offlineModeStore.isOfflineMode ? 'ti ti-wifi-off' : 'ti ti-wifi'" />
              </div>
              <span :class="$style.label">{{ offlineModeStore.isOfflineMode ? 'オフライン' : 'オンライン' }}</span>
            </button>
            <button
              class="_button"
              :class="[$style.item, realtimeModeStore.enabled ? $style.realtimeActive : $style.pollingActive, { [$style.itemDisabled]: offlineModeStore.isOfflineMode }]"
              :disabled="offlineModeStore.isOfflineMode"
              :title="realtimeModeStore.enabled ? 'ポーリングモードに切り替え' : 'リアルタイムモードに切り替え'"
              @click="hapticLight(); toggleRealtimeMode()"
            >
              <div :class="$style.iconWrap">
                <i :class="realtimeModeStore.enabled ? 'ti ti-bolt' : 'ti ti-bolt-off'" />
              </div>
              <span :class="$style.label">{{ realtimeModeStore.enabled ? 'リアルタイム' : 'ポーリング' }}</span>
            </button>
          </template>

          <!-- Post button -->
          <button
            class="_button"
            :class="$style.postBtn"
            title="ノート作成"
            @click="hapticMedium(); closeDrawerAndDo(() => emit('open-compose'))"
          >
            <i class="ti ti-pencil" />
            <span :class="$style.label">ノート</span>
          </button>

          <!-- Account button -->
          <div :class="$style.menuWrap">
            <button
              class="_button"
              :class="$style.item"
              title="アカウント"
              @pointerdown.stop
              @click.stop="isCompact ? toggleAccountPopup() : commandStore.execute('account-menu')"
            >
              <div :class="$style.iconWrap">
                <i class="ti ti-user" />
                <span v-if="accountAttentionCount > 0" :key="accountAttentionCount" :class="$style.badge">{{ accountAttentionCount > 99 ? '99+' : accountAttentionCount }}</span>
              </div>
              <span :class="$style.label">アカウント</span>
            </button>
            <!-- Mobile: bottom sheet via native <dialog> -->
            <dialog
              v-if="isCompact && accountPopupVisible"
              ref="accountDialogRef"
              class="_nativeDialog"
              :class="[$style.mobileBackdrop, accountPopupLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
            >
              <div
                autofocus
                tabindex="-1"
                :class="[$style.accountPopup, accountPopupLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
                @click.stop="accountMenuId = null"
              >
                <div
                  v-for="acc in accountsStore.accounts"
                  :key="acc.id"
                  :class="$style.accountPopupItem"
                  @click.stop="toggleAccountMenu(acc.id)"
                >
                  <div
                    :class="[$style.accountPopupBtn, { [$style.accountPopupBtnActive]: accountMenuId === acc.id }]"
                    :title="getAccountLabel(acc)"
                  >
                    <div :class="$style.avatarWrap">
                      <img
                        v-if="isGuestAccount(acc)"
                        src="/avatar-guest.svg"
                        :class="$style.avatar"
                      />
                      <img
                        v-else-if="acc.avatarUrl"
                        :src="proxyThumbUrl(acc.avatarUrl, 56)"
                        :class="$style.avatar"
                      />
                      <div v-else :class="[$style.avatar, $style.avatarPlaceholder]" />
                      <img
                        :src="getServerIconUrl(acc.host)"
                        :class="$style.serverBadge"
                        :title="acc.host"
                      />
                      <span
                        :class="[$style.onlineIndicator, onlineStatusClass(acc.id)]"
                      />
                    </div>
                    <span :class="$style.accountPopupName">{{ getAccountLabel(acc) }}</span>
                    <i class="ti ti-chevron-right" :class="$style.accountPopupChevron" />
                  </div>
                </div>
                <div :class="$style.accountPopupDivider" />
                <button
                  class="_button"
                  :class="$style.accountPopupBtn"
                  @click="showAccountPopup = false; closeDrawerAndDo(navigateToLogin)"
                >
                  <div :class="$style.accountPopupIcon"><i class="ti ti-plus" /></div>
                  <span>アカウント追加</span>
                </button>
              </div>
            </dialog>
            <NavAccountMenu
              v-if="showAccountPopup && selectedAccount"
              :key="accountMenuId!"
              show
              :account="selectedAccount"
              :modes="accountModes[selectedAccount.id] ?? {}"
              :toggling-mode="togglingMode"
              :mode-error="modeError"
              :is-admin="accountIsAdmin[selectedAccount.id] ?? false"
              @toggle-mode="toggleAccountMode(selectedAccount.id, $event)"
              @logout="showAccountPopup = false; showLogoutDialog(selectedAccount.id)"
              @relogin="(host: string) => { showAccountPopup = false; closeDrawerAndDo(() => navigateToLogin(host)) }"
              @clear-cache="showAccountPopup = false; clearAccountCache(selectedAccount.id)"
              @close="accountMenuId = null"
            />
          </div>
        </div>
      </div>

      <!-- Sub buttons (protruding tab) -->
      <div v-if="!isCompact" :class="$style.subButtons" @mouseenter="subButtonsHovered = true" @mouseleave="subButtonsHovered = false">
        <div :class="$style.subButton">
          <svg viewBox="0 0 16 64" :class="$style.subButtonShape">
            <g transform="matrix(0.333333,0,0,0.222222,0.000895785,21.3333)">
              <path d="M47.488,7.995C47.79,10.11 47.943,12.266 47.943,14.429C47.997,26.989 47.997,84 47.997,84C47.997,84 44.018,118.246 23.997,133.5C-0.374,152.07 -0.003,192 -0.003,192L-0.003,-96C-0.003,-96 0.151,-56.216 23.997,-37.5C40.861,-24.265 46.043,-1.243 47.488,7.995Z" fill="currentColor" />
            </g>
          </svg>
          <button class="_button" :class="$style.subButtonClickable" title="ナビバー編集" @click="windowsStore.open('navEditor')">
            <i class="ti ti-settings-2" :class="$style.subButtonIcon" />
          </button>
        </div>
        <div :class="$style.subButtonGapFill" />
        <div :class="$style.subButtonGapFillDivider" />
        <div :class="$style.subButton">
          <svg viewBox="0 0 16 64" :class="$style.subButtonShape">
            <g transform="matrix(0.333333,0,0,0.222222,0.000895785,21.3333)">
              <path d="M47.488,7.995C47.79,10.11 47.943,12.266 47.943,14.429C47.997,26.989 47.997,84 47.997,84C47.997,84 44.018,118.246 23.997,133.5C-0.374,152.07 -0.003,192 -0.003,192L-0.003,-96C-0.003,-96 0.151,-56.216 23.997,-37.5C40.861,-24.265 46.043,-1.243 47.488,7.995Z" fill="currentColor" />
            </g>
          </svg>
          <button class="_button" :class="$style.subButtonClickable" title="サイドバー切替" @click="toggleNav">
            <i :class="[navCollapsed ? 'ti ti-chevron-right' : 'ti ti-chevron-left', $style.subButtonIcon]" />
          </button>
        </div>
      </div>

      <!-- Mobile: nav editor button -->
      <div v-if="isCompact && props.mobileDrawerOpen" :class="$style.mobileSubButton">
        <svg viewBox="0 0 16 64" :class="$style.subButtonShape">
          <g transform="matrix(0.333333,0,0,0.222222,0.000895785,21.3333)">
            <path d="M47.488,7.995C47.79,10.11 47.943,12.266 47.943,14.429C47.997,26.989 47.997,84 47.997,84C47.997,84 44.018,118.246 23.997,133.5C-0.374,152.07 -0.003,192 -0.003,192L-0.003,-96C-0.003,-96 0.151,-56.216 23.997,-37.5C40.861,-24.265 46.043,-1.243 47.488,7.995Z" fill="currentColor" />
          </g>
        </svg>
        <button class="_button" :class="$style.subButtonClickable" title="ナビバー編集" @click="closeDrawerAndDo(() => windowsStore.open('navEditor'))">
          <i class="ti ti-settings-2" :class="$style.subButtonIcon" />
        </button>
      </div>
    </nav>

    <!-- Resize handle -->
    <div
      v-if="!isCompact"
      :class="[$style.resizeHandle, { [$style.resizeActive]: isResizing }]"
      :style="subButtonsHovered ? { pointerEvents: 'none' } : undefined"
      @pointerdown="startResize"
    />

    <LogoutDialog
      :show="logoutTargetId != null"
      :is-guest="logoutTargetId ? isGuestAccount(accountsStore.accountMap.get(logoutTargetId) as Account) : false"
      @keep-data="logoutKeepData"
      @delete-all="logoutDeleteAll"
      @cancel="logoutTargetId = null"
    />

    <DeckLaunchPad v-if="showLaunchPad" :anchor="launchPadAnchor" @close="showLaunchPad = false" />
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/navMenu';

.wrapper {
  display: contents;
}

// ============================================================
// Left Navbar — base styles (all sizes)
// ============================================================
.navbar {
  flex: 0 0 auto;
  display: flex;
  background: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));
  border-right: var(--nd-nav-border) solid var(--nd-divider);
  position: relative;
  z-index: 1;
  container-type: inline-size;
  container-name: navbar;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  direction: rtl;

  > * {
    direction: ltr;
  }
}

.top {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  height: 36px;
  flex-shrink: 0;
}

.instanceBtn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.instanceIcon {
  width: 30px;
  aspect-ratio: 1;
  border-radius: 4px;
  user-select: none;
  -webkit-user-select: none;
}

.topBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--nd-navFg, var(--nd-fg));

  :global(.ti) {
    font-size: 20px;
    opacity: 0.7;
  }

  &:hover :global(.ti) {
    opacity: 1;
  }
}

.topScroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  direction: rtl;

  > * {
    direction: ltr;
  }
}

.section {
  display: flex;
  flex-direction: column;
  padding: 10px 6px;
}

.bottomSection {
  flex-shrink: 0;
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 10px 6px;
  align-self: stretch;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  line-height: 2.85rem;
  border-radius: var(--nd-radius-full);
  color: var(--nd-navFg, var(--nd-fg));
  font-size: 0.95em;
  white-space: nowrap;
  text-decoration: none;
  transition: background var(--nd-duration-base), color var(--nd-duration-base), transform var(--nd-duration-fast) var(--nd-ease-spring);

  &:hover {
    background: var(--nd-buttonHoverBg);
    color: var(--nd-fgHighlighted);

    :global(.ti) {
      opacity: 1;
    }
  }

  :global(.ti) {
    @include nav-icon;
    flex-shrink: 0;
    width: 32px;
    text-align: center;
    opacity: 0.7;
  }
}

.sidebarActive {
  background: var(--nd-buttonHoverBg);
  color: var(--nd-fgHighlighted);

  :global(.ti) {
    opacity: 1;
  }
}

// AI 操作の可視化 (Spotlight): Windows タスクバー風アンダーバー (朱色 + オレンジ枠)。
// 現状 MVP では emit されないが、Phase 2 のサイドバー toggle 系 capability で
// 自動的に光るよう infrastructure として常駐。.sidebarActive は背景色のみで
// ::after/::before を使わないので隠す処理は不要。
.spotlighted {
  position: relative;
  isolation: isolate;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      180deg,
      rgba(170, 30, 30, 0.55) 0%,
      rgba(200, 55, 45, 0.3) 50%,
      rgba(220, 90, 80, 0.05) 100%
    );
    box-shadow: 0 -1px 8px rgba(170, 30, 30, 0.25);
    pointer-events: none;
    z-index: 0;
    animation: spotlightFill 2.4s ease-out 1 forwards;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      animation: none;
      opacity: 1;
    }
  }
}

@keyframes spotlightFill {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}

.onlineActive {
  color: #86b300;

  :global(.ti) {
    opacity: 1;
  }
}

.offlineActive {
  color: #d32f2f;

  :global(.ti) {
    opacity: 1;
  }
}

.realtimeActive {
  color: #e2a100;

  :global(.ti) {
    opacity: 1;
  }
}

.pollingActive {
  color: #9c27b0;

  :global(.ti) {
    opacity: 1;
  }
}

.itemDisabled {
  opacity: 0.35;
  pointer-events: none;
}

.iconWrap { @include nav-icon-wrap; }
.badge { @include nav-badge; }

.label {
  overflow: hidden;
  text-overflow: ellipsis;
}

// Account popup — bottom sheet inside <dialog class="_nativeDialog">
.accountPopup {
  width: 100%;
  margin: 0;
  border-radius: 16px 16px 0 0;
  background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
  max-height: 80vh;
  overflow-y: auto;
  padding: 8px 0 calc(8px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.accountPopupItem {
  position: relative;
}

.accountPopupBtn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  width: 100%;
  font-size: 0.85em;
  color: var(--nd-fg);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.accountPopupBtnActive {
  background: var(--nd-buttonHoverBg);
  color: var(--nd-fgHighlighted);
}

.accountPopupChevron {
  margin-left: auto;
  font-size: 0.75em;
  opacity: 0.4;
  flex-shrink: 0;
}

.accountPopupName {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.accountPopupIcon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 14px;
  flex-shrink: 0;
}

.accountPopupDivider {
  height: 1px;
  background: var(--nd-divider);
  margin: 4px 0;
}

.avatarWrap {
  position: relative;
  flex-shrink: 0;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.avatarPlaceholder {
  background: var(--nd-buttonBg);
}

.serverBadge {
  position: absolute;
  top: -2px;
  right: -4px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid var(--nd-navBg);
}

.onlineIndicator {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 20%;
  height: 20%;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--nd-navBg);
}

.statusOnline {
  background: var(--nd-statusOnline);
}

.statusActive {
  background: var(--nd-statusActive);
}

.statusOffline {
  background: var(--nd-statusOffline);
}

.statusUnknown {
  background: var(--nd-statusUnknown);
}




.postBtn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--nd-radius-full);
  background: linear-gradient(90deg, var(--nd-buttonGradateA, var(--nd-accent)), var(--nd-buttonGradateB, var(--nd-accentDarken)));
  color: var(--nd-fgOnAccent, #fff);
  font-weight: bold;
  font-size: 0.9em;
  white-space: nowrap;
  transition: transform var(--nd-duration-fast) var(--nd-ease-spring), box-shadow var(--nd-duration-base);

  &:hover {
    transform: scale(1.03);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--nd-accent) 40%, transparent);
  }

  &:active {
    transform: scale(var(--nd-active-scale));
  }

  :global(.ti) {
    flex-shrink: 0;
    width: 32px;
    font-size: 1.5em;
    text-align: center;
  }
}

.resizeHandle {
  flex: 0 0 var(--nd-nav-resize-handle);
  cursor: col-resize;
  background: transparent;
  transition: background var(--nd-duration-base);
  z-index: 10;

  &:hover,
  &.resizeActive {
    background: var(--nd-accent);
    opacity: 0.4;
  }
}

.resizeActive {
  opacity: 0.6;
}

.subButtons {
  --sub-button-width: 20px;

  position: absolute;
  right: 0;
  bottom: 80px;
  translate: 100% 0;
  z-index: 11;
}

.subButton {
  display: block;
  position: relative;
  width: var(--sub-button-width);
  height: 50px;
  align-content: center;
}

.subButtonShape {
  position: absolute;
  z-index: 0;
  top: 0;
  bottom: 0;
  left: 0;
  margin: auto;
  width: var(--sub-button-width);
  height: calc(var(--sub-button-width) * 4);
  pointer-events: none;
  color: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));
}

.subButtonClickable {
  position: absolute;
  z-index: 1;
  display: block;
  max-width: unset;
  width: 24px;
  height: 42px;
  top: 0;
  bottom: 0;
  left: -4px;
  margin: auto;
  font-size: 13px;
  color: var(--nd-navFg, var(--nd-fg));
  cursor: pointer;

  :global(.ti) {
    opacity: 0.7;
  }

  &:hover :global(.ti) {
    opacity: 1;
  }
}

.subButtonIcon {
  margin-left: -4px;
}

.subButtonGapFill {
  position: relative;
  width: var(--sub-button-width);
  height: 64px;
  margin-top: -32px;
  margin-bottom: -32px;
  pointer-events: none;
  background: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));
}

.subButtonGapFillDivider {
  position: relative;
  z-index: 1;
  margin-left: -2px;
  width: 14px;
  height: 1px;
  background: var(--nd-divider);
  pointer-events: none;
}

.mobileOnly {
  display: flex;
  flex-direction: column;
}

.menuWrap {
  position: relative;
  display: flex;
  flex-direction: column;
}

.updateDot { @include update-dot; }

// ============================================================
// Icon-only mode — navbar adapts to its own width via
// Container Query. No class flags needed.
// ============================================================
@container navbar (max-width: 80px) {
  .body {
    overflow: visible;
    direction: ltr;
  }

  .label {
    display: none;
  }

  .top {
    padding-left: 0;
    justify-content: center;
  }

  .instanceIcon {
    width: 30px;
    border-radius: 4px;
  }

  .item {
    justify-content: center;
    padding: 0;
    width: 44px;
    height: 44px;
    margin: 2px auto;
    border-radius: 50%;

    :global(.ti) { @include nav-icon; }
  }

  .accountPopup {
    bottom: 0;
    left: 100%;
    right: auto;
    margin-bottom: 0;
    margin-left: 4px;
  }

  .section {
    padding: 8px 0 0;
    align-items: center;
  }

  .postBtn {
    width: 44px;
    height: 44px;
    padding: 0;
    margin: 0 auto;
    border-radius: 50%;
    justify-content: center;

    :global(.ti) { @include nav-icon; }
  }
}

// ============================================================
// Drawer mode (mobile platform)
// ============================================================
.drawerMode {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: calc(var(--nd-z-navbar) + 1);
  width: 250px !important;
  flex-basis: 250px !important;
  padding-top: max(var(--nd-safe-area-top, env(safe-area-inset-top)), 12px);
  padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));
  padding-left: env(safe-area-inset-left, 0px);
  translate: -100% 0;
  transition: translate 0.15s ease;
  box-shadow: none;
  background: var(--nd-navBg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;

  .item {
    min-height: 44px;
  }
}

.drawerOpen {
  translate: 0 0;
  box-shadow: 4px 0 16px rgb(0 0 0 / 0.3);
}

.mobileSubButton {
  position: absolute;
  right: 0;
  bottom: 80px;
  translate: 100% 0;
  width: var(--sub-button-width, 20px);
  height: 50px;
  align-content: center;

  .subButtonShape {
    color: var(--nd-navBg);
  }
}
</style>
