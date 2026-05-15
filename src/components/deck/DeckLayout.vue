<script setup lang="ts">
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  useTemplateRef,
} from 'vue'
import { useCommandStore } from '@/commands/registry'
import AppConfirm from '@/components/common/AppConfirm.vue'
import AppPrompt from '@/components/common/AppPrompt.vue'
import AppToast from '@/components/common/AppToast.vue'
import MkRippleEffect from '@/components/common/MkRippleEffect.vue'
import { useBackButton } from '@/composables/useBackButton'
import { useDeckInit } from '@/composables/useDeckInit'
import { requestMoveColumn } from '@/composables/useDeckWindow'
import { useFileDrop } from '@/composables/useFileDrop'
import { useNavigation } from '@/composables/useNavigation'
import { usePortal } from '@/composables/usePortal'
import { useRippleEffect } from '@/composables/useRippleEffect'
import { provideScrollDirection } from '@/composables/useScrollDirection'
import { useSpotlightStore } from '@/composables/useSpotlight'
import { useUpdater } from '@/composables/useUpdater'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { useIsCompactLayout, useUiStore } from '@/stores/ui'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckBottomBar from './DeckBottomBar.vue'
import DeckColumnsArea from './DeckColumnsArea.vue'
import DeckMobileNav from './DeckMobileNav.vue'
import DeckNavbar from './DeckNavbar.vue'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)
const AddColumnDialog = defineAsyncComponent(
  () => import('./AddColumnDialog.vue'),
)

const {
  navigateToNote,
  navigateToUser,
  navigateToSearch,
  navigateToNotifications,
} = useNavigation()
const commandStore = useCommandStore()
const deckStore = useDeckStore()
const spotlightStore = useSpotlightStore()
const uiStore = useUiStore()
const accountsStore = useAccountsStore()
const isCompact = useIsCompactLayout()
const navbarRef = ref<InstanceType<typeof DeckNavbar> | null>(null)
const columnsAreaRef = ref<InstanceType<typeof DeckColumnsArea> | null>(null)
const showAddMenu = ref(false)
const showCompose = ref(false)
const showProfileMenu = ref(false)
const showSettingsMenu = ref(false)
const mobileDrawerOpen = ref(false)
const pendingFilePaths = ref<string[]>([])
const pendingComposeAccountId = ref<string | null>(null)
const addMenuPortalRef = useTemplateRef<HTMLElement>('addMenuPortalRef')
const composePortalRef = useTemplateRef<HTMLElement>('composePortalRef')
usePortal(addMenuPortalRef)
usePortal(composePortalRef)
const activeColumnIndex = computed(() => {
  const id = deckStore.activeColumnId
  if (!id) return 0
  const idx = deckStore.windowLayout.findIndex((g) => g.includes(id))
  return idx >= 0 ? idx : 0
})
const { updateAvailable, checkForUpdate } = useUpdater()
useStreamInspectorStore().startWatching()
const { ripples, remove: removeRipple } = useRippleEffect()

// Android back button: close overlays instead of exiting
if (uiStore.isMobilePlatform) {
  useBackButton(mobileDrawerOpen, () => {
    mobileDrawerOpen.value = false
  })
  useBackButton(showCompose, closeCompose)
  useBackButton(showAddMenu, () => {
    showAddMenu.value = false
  })
}

const wallpaperStyle = computed(() =>
  deckStore.wallpaper != null
    ? { backgroundImage: `url(${deckStore.wallpaper})` }
    : undefined,
)

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i

function openCompose() {
  if (accountsStore.accounts.length === 0) return
  showCompose.value = !showCompose.value
  if (!showCompose.value) {
    pendingFilePaths.value = []
  }
}

function closeCompose() {
  showCompose.value = false
  pendingFilePaths.value = []
  pendingComposeAccountId.value = null
}

function toggleAddMenu() {
  if (!isCompact.value) {
    commandStore.openWithInput('+')
  } else {
    showAddMenu.value = !showAddMenu.value
  }
}

// File drop handling
// Drop targets follow physical layering: only the topmost visible surface accepts drops.
// - Post form open → only the form itself (not the backdrop)
// - Post form closed → only columns (not the deck background)
const fileDrop = useFileDrop((paths, position) => {
  const el = document.elementFromPoint(position.x, position.y)

  if (showCompose.value) {
    // Only accept drops that land on the post form, not the dark backdrop
    if (el?.closest('[data-post-form]')) {
      pendingFilePaths.value = paths
    }
    return
  }

  const columnCell = el?.closest('[data-column-id]') as HTMLElement | null
  if (!columnCell) return

  const colId = columnCell.dataset.columnId
  const col = colId ? columnsAreaRef.value?.columnMap.get(colId) : undefined

  if (col?.type === 'drive' && col.accountId) {
    const accountId = col.accountId
    for (const path of paths) {
      commands.apiUploadFileFromPath(accountId, path, false, null).then((r) => {
        unwrap(r)
        uiStore.emitDriveFilesChanged(accountId)
      })
    }
    return
  }

  if (paths.length === 1 && IMAGE_EXTENSIONS.test(paths[0] ?? '')) {
    deckStore.setWallpaper(convertFileSrc(paths[0] ?? ''))
  }
})

// Vapor-compatible transitions
const drawerT = useVaporTransition(mobileDrawerOpen, { leaveDuration: 200 })
const addMenuT = useVaporTransition(showAddMenu, { leaveDuration: 200 })
const composeShow = computed(
  () => showCompose.value && accountsStore.accounts.length > 0,
)
const composeT = useVaporTransition(composeShow, { leaveDuration: 200 })
const fileDropShow = computed(() => fileDrop.isDragging.value)
const fileDropT = useVaporTransition(fileDropShow, { leaveDuration: 200 })
const crossDropShow = computed(() => !!deckStore.crossWindowDragColumnId)
const crossDropT = useVaporTransition(crossDropShow, { leaveDuration: 200 })

// チャット/AIチャット系カラムでは入力欄の送信ボタンと FAB が重なるため隠す。
// デスクトップ→モバイルサイズ切替直後など activeColumnId が未確定な瞬間は
// 「スマホサイズで実際に表示される先頭カラム」(windowLayout[0][0]) にフォールバック
const fabShow = computed(() => {
  if (!isCompact.value) return false
  const id = deckStore.activeColumnId ?? deckStore.windowLayout[0]?.[0]
  if (!id) return true
  const col = deckStore.columnMap.get(id)
  return col?.type !== 'chat' && col?.type !== 'ai'
})
const fabT = useVaporTransition(fabShow, { leaveDuration: 200 })

provideScrollDirection()

// Initialize deck data + app-level side effects
deckStore.load()

useDeckInit({
  openCompose,
  navigateToSearch,
  navigateToNotifications,
  navigateToNote,
  navigateToUser,
  toggleAddMenu,
  navbarRef,
  checkForUpdate,
})

// Preload heavy chunks during idle time so first open is instant (production only —
// in dev, on-demand transpilation makes this counterproductive)
if (import.meta.env.PROD) {
  onMounted(() => {
    const idle =
      window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200))
    idle(() => {
      import('@/components/common/MkPostForm.vue')
      import('@/components/window/NoteDetailContent.vue')
      import('@/components/window/UserProfileContent.vue')
    })
  })
}

function scrollToColumn(index: number) {
  const group = deckStore.windowLayout[index]
  const colId = group?.[0]
  if (!colId) return

  if (colId === deckStore.activeColumnId) {
    columnsAreaRef.value?.scrollColumnToTop(index)
    return
  }

  deckStore.setActiveColumn(colId)
}

// columnMap for DeckMobileNav (computed from store directly)
const columns = computed(() => deckStore.columns)

// Cross-window drag & drop
function acceptCrossWindowDrop() {
  const columnId = deckStore.crossWindowDragColumnId
  if (!columnId) return
  deckStore.crossWindowDragColumnId = null
  // Move column to this window
  requestMoveColumn(columnId, deckStore.currentWindowId ?? null)
}
</script>

<template>
  <div :class="[$style.root, { [$style.mobile]: isCompact }]">
    <!-- Spotlight 用 SR-only aria-live 領域 (AI 操作のテキスト読み上げ) -->
    <div :class="$style.srOnly" aria-live="polite" aria-atomic="true">
      {{ spotlightStore.lastAnnouncement }}
    </div>

    <DeckNavbar
      ref="navbarRef"
      :mobile-drawer-open="mobileDrawerOpen"
      :show-profile-menu="showProfileMenu"
      :show-settings-menu="showSettingsMenu"
      :update-available="updateAvailable"
      @open-compose="openCompose"
      @update:mobile-drawer-open="mobileDrawerOpen = $event"
      @update:show-profile-menu="showProfileMenu = $event"
      @update:show-settings-menu="showSettingsMenu = $event"
    />

    <!-- Main content area -->
    <div
      :class="[$style.mainArea, { [$style.withWallpaper]: deckStore.wallpaper != null }]"
      :style="wallpaperStyle"
    >
      <DeckColumnsArea ref="columnsAreaRef" />

      <DeckBottomBar
        v-if="!isCompact"
        :columns="columns"
        :layout="deckStore.windowLayout"
        :active-column-index="activeColumnIndex"
        @scroll-to-column="scrollToColumn"
      />
    </div>

    <!-- Mobile FAB -->
    <button
      v-if="fabT.visible.value"
      class="_button"
      :class="[$style.fab, fabT.entering.value && $style.fadeEnter, fabT.leaving.value && $style.fadeLeave]"
      title="新しいノート"
      @click="openCompose"
    >
      <i class="ti ti-pencil" />
    </button>

    <!-- Mobile drawer overlay -->
    <div
      v-if="drawerT.visible.value"
      :class="[$style.drawerOverlay, drawerT.entering.value && $style.fadeEnter, drawerT.leaving.value && $style.fadeLeave]"
      @click="mobileDrawerOpen = false"
    />

    <!-- Mobile bottom nav -->
    <DeckMobileNav
      v-if="isCompact"
      :columns="columns"
      :layout="deckStore.windowLayout"
      :active-column-index="activeColumnIndex"
      @scroll-to-column="scrollToColumn"
      @toggle-add-menu="toggleAddMenu"
      @toggle-drawer="mobileDrawerOpen = !mobileDrawerOpen"
    />

    <!-- Add column popup -->
    <div v-if="addMenuT.visible.value" ref="addMenuPortalRef">
      <AddColumnDialog
        :class="[addMenuT.entering.value && $style.modalEnter, addMenuT.leaving.value && $style.modalLeave]"
        @close="showAddMenu = false"
      />
    </div>

    <div v-if="composeT.visible.value" ref="composePortalRef">
      <MkPostForm
        :class="[composeT.entering.value && $style.modalEnter, composeT.leaving.value && $style.modalLeave]"
        :account-id="pendingComposeAccountId ?? accountsStore.accounts[0]!.id"
        :initial-file-paths="pendingFilePaths"
        @close="closeCompose"
        @posted="closeCompose"
      />
    </div>

    <!-- File drop overlay -->
    <div
      v-if="fileDropT.visible.value"
      :class="[$style.fileDropOverlay, fileDropT.entering.value && $style.fadeEnter, fileDropT.leaving.value && $style.fadeLeave]"
    >
      <div :class="$style.dropContent">
        <i class="ti ti-upload" />
        <span>ファイルをドロップしてアップロード</span>
      </div>
    </div>

    <AppToast />
    <AppConfirm />
    <AppPrompt />

    <!-- Misskey-style ripple effects (reaction celebration particles) -->
    <MkRippleEffect
      v-for="r in ripples"
      :key="r.id"
      :x="r.x"
      :y="r.y"
      @done="removeRipple(r.id)"
    />

    <!-- Cross-window column drop overlay -->
    <div
      v-if="crossDropT.visible.value"
      :class="[$style.crossWindowDropOverlay, crossDropT.entering.value && $style.fadeEnter, crossDropT.leaving.value && $style.fadeLeave]"
      @click="acceptCrossWindowDrop"
    >
      <div :class="$style.dropContent">
        <i class="ti ti-arrows-move" />
        <span>ここにカラムを移動</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
}

// Spotlight (AI 操作可視化) 用 SR-only aria-live region。
// 視覚的には不可視、スクリーンリーダーのみ拾う。
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mobile {
  flex-direction: column;
  padding-top: var(--nd-safe-area-top, env(safe-area-inset-top));
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  background: var(--nd-navBg);
}

.mainArea {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--nd-deckBg);
}

.withWallpaper {
  background: none;
  background-size: cover;
  background-position: center;
}

.fab {
  display: flex;
  align-items: center;
  justify-content: center;
  position: fixed;
  right: calc(16px + env(safe-area-inset-right));
  bottom: calc(var(--nd-mobileNavHeight, 0px) + 12px);
  z-index: var(--nd-z-overlay);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(
    90deg,
    var(--nd-buttonGradateA, var(--nd-accent)),
    var(--nd-buttonGradateB, var(--nd-accentDarken))
  );
  color: var(--nd-fgOnAccent, #fff);
  font-size: 20px;
  box-shadow: 0 4px 12px var(--nd-shadow);
  transition: transform var(--nd-duration-slower) ease, box-shadow var(--nd-duration-slow) ease;

  &:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 20px
      color-mix(in srgb, var(--nd-accent) 40%, rgba(0, 0, 0, 0.3));
  }

  &:active {
    transform: scale(0.92);
  }
}

.drawerOverlay {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-navbar);
  background: rgb(0 0 0 / 0.5);
}

.fileDropOverlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--nd-z-popup) - 1);
  background: var(--nd-overlayDark);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.crossWindowDropOverlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--nd-z-popup) - 2);
  background: color-mix(in srgb, var(--nd-accent, #86b300) 20%, rgba(0, 0, 0, 0.5));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 3px dashed var(--nd-accent, #86b300);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent, #86b300) 30%, rgba(0, 0, 0, 0.5));
  }
}

.dropContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #fff;
  font-size: 18px;
  font-weight: 600;

  .ti {
    font-size: 48px;
    opacity: 0.9;
  }
}

.fadeEnter { animation: fadeIn var(--nd-duration-base) var(--nd-ease-decel); }
.fadeLeave { animation: fadeOut var(--nd-duration-base) ease-out forwards; }
@keyframes fadeIn { from { opacity: 0; } }
@keyframes fadeOut { to { opacity: 0; } }

.modalEnter { animation: modalIn 0.2s var(--nd-ease-spring); }
.modalLeave { animation: modalOut var(--nd-duration-base) var(--nd-ease-decel) forwards; }
@keyframes modalIn { from { opacity: 0; } }
@keyframes modalOut { to { opacity: 0; } }
</style>

