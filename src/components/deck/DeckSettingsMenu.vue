<script setup lang="ts">
import { relaunch } from '@tauri-apps/plugin-process'
import type { CSSProperties, Ref } from 'vue'
import {
  computed,
  nextTick,
  reactive,
  ref,
  toRef,
  useTemplateRef,
  watch,
} from 'vue'

import { useMenuKeyboard } from '@/composables/useMenuKeyboard'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { usePortal } from '@/composables/usePortal'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { type ConfirmOptions, useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useKeybindsStore } from '@/stores/keybinds'
import { usePerformanceStore } from '@/stores/performance'
import { useThemeStore } from '@/stores/theme'
import { useIsCompactLayout, useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { hapticSelection } from '@/utils/haptics'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DayNightToggle from './DayNightToggle.vue'

const props = defineProps<{
  show: boolean
  anchor?: HTMLElement | null
}>()

const emit = defineEmits<{
  close: []
  'close-all': []
}>()

const isCompact = useIsCompactLayout()
const { visible: menuVisible, leaving: menuLeaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 180, leaveDuration: 180 },
)
const { isMobilePlatform } = useUiStore()
const deckStore = useDeckStore()
const keybindsStore = useKeybindsStore()
const perfStore = usePerformanceStore()
const themeStore = useThemeStore()
const isDark = computed(() => !themeStore.currentSource?.kind.includes('light'))
const isFollowingSystem = computed(() => themeStore.manualMode == null)
const fileInput = ref<HTMLInputElement | null>(null)
const expandedSections = reactive<Record<string, boolean>>({})

function toggleSection(key: string) {
  expandedSections[key] = !expandedSections[key]
}

const menuEl = ref<HTMLElement | null>(null)
const fixedStyle = ref<CSSProperties | undefined>()
const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => menuVisible.value && isCompact.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 180,
  },
)

const { activate: activateKeyboard, deactivate: deactivateKeyboard } =
  useMenuKeyboard({
    containerRef: menuEl,
    itemSelector: 'button, [tabindex="0"]',
    onClose: () => emit('close'),
  })

watch(
  () => props.show,
  (val) => {
    if (val) {
      if (props.anchor && !isCompact.value) {
        const rect = props.anchor.getBoundingClientRect()
        fixedStyle.value = {
          position: 'fixed',
          bottom: `${window.innerHeight - rect.top + 4}px`,
          right: `${window.innerWidth - rect.right}px`,
        }
      } else {
        fixedStyle.value = undefined
      }
      if (!isCompact.value) nextTick(activateKeyboard)
    } else {
      deactivateKeyboard()
    }
  },
  { immediate: true },
)

function toggleDarkMode() {
  hapticSelection()
  themeStore.toggleTheme()
}

function toggleSyncDevice(checked: boolean) {
  hapticSelection()
  if (checked) {
    themeStore.resetToOsTheme()
  } else {
    themeStore.pinCurrentMode()
  }
}

function pickWallpaper() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    deckStore.setWallpaper(reader.result as string)
  }
  reader.readAsDataURL(file)
  if (fileInput.value) fileInput.value.value = ''
}

function removeWallpaper() {
  deckStore.clearWallpaper()
}

const windowsStore = useWindowsStore()

function openToolWindow(
  type:
    | 'cssEditor'
    | 'keybinds'
    | 'plugins'
    | 'aiSettings'
    | 'performanceEditor'
    | 'appearanceEditor'
    | 'backup'
    | 'cacheEditor'
    | 'tasksEditor'
    | 'snippetsEditor',
  props: Record<string, unknown> = {},
) {
  windowsStore.open(type, props)
  emit('close')
}

const { confirm } = useConfirm()

const isExporting = ref(false)
const isImportingDb = ref(false)
const isExportingSettings = ref(false)
const isImportingSettings = ref(false)
const backupError = ref('')

async function backupAction(
  loading: Ref<boolean>,
  action: () => Promise<unknown>,
  opts?: { confirmOpts?: ConfirmOptions; relaunch?: boolean },
) {
  if (opts?.confirmOpts && !(await confirm(opts.confirmOpts))) return
  loading.value = true
  backupError.value = ''
  try {
    const result = await action()
    if (result && opts?.relaunch) {
      await relaunch()
    }
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const exportDb = () =>
  backupAction(isExporting, () => commands.exportDb().then((r) => unwrap(r)))
const importDb = () =>
  backupAction(
    isImportingDb,
    () => commands.importDb().then((r) => unwrap(r)),
    {
      confirmOpts: {
        title: 'DBインポート',
        message: '現在のDBが上書きされます。',
        okLabel: 'インポート',
        type: 'danger',
      },
      relaunch: true,
    },
  )
const exportSettings = () =>
  backupAction(isExportingSettings, () =>
    commands.exportSettingsJson().then((r) => unwrap(r)),
  )
const importSettings = () =>
  backupAction(
    isImportingSettings,
    () => commands.importSettingsJson().then((r) => unwrap(r)),
    {
      confirmOpts: {
        title: '設定インポート',
        message: '現在の設定が上書きされます。',
        okLabel: 'インポート',
        type: 'danger',
      },
      relaunch: true,
    },
  )

const cacheNoteCount = ref<number | null>(null)
const cacheDbBytes = ref<number | null>(null)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const cacheSummary = computed(() => {
  if (cacheNoteCount.value == null || cacheDbBytes.value == null) return null
  const count = cacheNoteCount.value.toLocaleString()
  return `${count} ノート / ${formatBytes(cacheDbBytes.value)}`
})

async function refreshCacheStats() {
  try {
    const stats = unwrap(await commands.cacheStats())
    cacheNoteCount.value = stats.noteCount
    cacheDbBytes.value = stats.dbSizeBytes
  } catch (e) {
    if (import.meta.env.DEV) console.debug('[cache-stats] fetch failed:', e)
  }
}

// メニュー表示時に統計を取得 (キャッシュエディタを開いた直後に値を fresh に)
watch(
  () => props.show,
  (show) => {
    if (show) refreshCacheStats()
  },
  { immediate: true },
)

const settingsMenuPortalRef = useTemplateRef<HTMLElement>(
  'settingsMenuPortalRef',
)
usePortal(settingsMenuPortalRef)
</script>

<template>
  <!-- Desktop: portal-rendered popup -->
  <div v-if="!isCompact && (show || menuVisible)" ref="settingsMenuPortalRef">
  <div v-if="show" :class="$style.menuBackdrop" @pointerdown="emit('close')" />
    <div v-if="menuVisible" ref="menuEl" :class="[$style.settingsMenu, menuLeaving ? $style.menuLeave : $style.menuEnter]" :style="fixedStyle" class="_popupMenu" @pointerdown.stop>
      <div :class="$style.menuBody">
      <!-- アピアランス -->
      <div :class="$style.categorySection">
        <!-- モバイル: ウィンドウで開く -->
        <button v-if="isCompact" :class="$style.categoryHeader" @click="openToolWindow('appearanceEditor')">
          <i class="ti ti-brush" />
          <span>アピアランス</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
        <!-- デスクトップ: アコーディオン -->
        <template v-else>
        <button :class="$style.categoryHeader" @click="toggleSection('appearance')">
          <i class="ti ti-brush" />
          <span>アピアランス</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.appearance }]" />
        </button>
        <div v-if="expandedSections.appearance" :class="$style.categoryBody">
          <DayNightToggle
            :is-dark="isDark"
            :is-following-system="isFollowingSystem"
            @toggle-dark="toggleDarkMode"
            @toggle-sync="(checked: boolean) => toggleSyncDevice(checked)"
          />

          <!-- テーマ選択 / 編集 / 削除 はテーマカラム (themeManager) に集約。
               ここから個別 UI は提供しない。テーマカラムを開くには
               コマンドパレット → 「テーマを管理」を使う。 -->

          <button v-if="deckStore.wallpaper == null" :class="$style.settingsMenuItem" @click="pickWallpaper">
            <i class="ti ti-photo" />
            <span :class="$style.settingsMenuLabel">壁紙を設定</span>
          </button>
          <button v-else :class="$style.settingsMenuItem" @click="removeWallpaper">
            <i class="ti ti-photo-off" />
            <span :class="$style.settingsMenuLabel">壁紙を削除</span>
          </button>
        </div>
        </template>
      </div>

      <input
        v-if="!isCompact"
        ref="fileInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="onFileSelected"
      />

      <!-- 環境設定 (モバイル: フラットに展開) -->
      <template v-if="isCompact">
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('aiSettings')">
            <i class="ti ti-robot" />
            <span>AI</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('performanceEditor')">
            <i class="ti ti-gauge" />
            <span>パフォーマンス</span>
            <span v-if="Object.keys(perfStore.overrides).length > 0" :class="$style.activeDot" />
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('cssEditor')">
            <i class="ti ti-code" />
            <span>カスタムCSS</span>
            <span v-if="themeStore.customCss" :class="$style.activeDot" />
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('tasksEditor')">
            <i class="ti ti-player-play" />
            <span>タスク</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('snippetsEditor')">
            <i class="ti ti-code-plus" />
            <span>スニペット</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
      </template>
      <!-- 環境設定 (デスクトップ: アコーディオン) -->
      <div v-else :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="toggleSection('settings')">
          <i class="ti ti-settings" />
          <span>環境設定</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.settings }]" />
        </button>
        <div v-if="expandedSections.settings" :class="$style.categoryBody">
          <button :class="$style.settingsMenuItem" @click="openToolWindow('aiSettings')">
            <i class="ti ti-robot" />
            <span :class="$style.settingsMenuLabel">AI</span>
          </button>
          <button v-if="!isMobilePlatform" :class="$style.settingsMenuItem" @click="openToolWindow('keybinds')">
            <i class="ti ti-keyboard" />
            <span :class="$style.settingsMenuLabel">キーバインド</span>
            <span v-if="Object.keys(keybindsStore.overrides).length > 0" :class="$style.activeDot" />
          </button>
          <button :class="$style.settingsMenuItem" @click="openToolWindow('performanceEditor')">
            <i class="ti ti-gauge" />
            <span :class="$style.settingsMenuLabel">パフォーマンス</span>
            <span v-if="Object.keys(perfStore.overrides).length > 0" :class="$style.activeDot" />
          </button>
          <button :class="$style.settingsMenuItem" @click="openToolWindow('cssEditor')">
            <i class="ti ti-code" />
            <span :class="$style.settingsMenuLabel">カスタムCSS</span>
            <span v-if="themeStore.customCss" :class="$style.activeDot" />
          </button>
          <button :class="$style.settingsMenuItem" @click="openToolWindow('tasksEditor')">
            <i class="ti ti-player-play" />
            <span :class="$style.settingsMenuLabel">タスク</span>
          </button>
          <button :class="$style.settingsMenuItem" @click="openToolWindow('snippetsEditor')">
            <i class="ti ti-code-plus" />
            <span :class="$style.settingsMenuLabel">スニペット</span>
          </button>
        </div>
      </div>

      <!-- データ (モバイル: バックアップとキャッシュを分割) -->
      <template v-if="isCompact">
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('backup')">
            <i class="ti ti-database" />
            <span>バックアップ</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('cacheEditor')">
            <i class="ti ti-eraser" />
            <span>キャッシュ</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
      </template>
      <!-- データ (デスクトップ: 従来のアコーディオン) -->
      <div v-else :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="toggleSection('data')">
          <i class="ti ti-database" />
          <span>データ</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.data }]" />
        </button>
        <div v-if="expandedSections.data" :class="$style.categoryBody">
          <div :class="$style.dataGroup">
            <span :class="$style.dataGroupLabel">
              <i class="ti ti-eraser" /> キャッシュ
              <span v-if="cacheSummary" :class="$style.cacheSummary">{{ cacheSummary }}</span>
            </span>
            <div :class="$style.dataBtnRow">
              <button class="_button" :class="$style.dataBtn" @click="openToolWindow('cacheEditor')">
                <i class="ti ti-settings" />
                キャッシュを管理
              </button>
            </div>
          </div>
          <div :class="$style.dataGroup">
            <span :class="$style.dataGroupLabel"><i class="ti ti-database-export" /> DBバックアップ</span>
            <div :class="$style.dataBtnRow">
              <button class="_button" :class="$style.dataBtn" :disabled="isImportingDb" @click="importDb">
                <i class="ti ti-clipboard-text" />
                {{ isImportingDb ? '処理中...' : 'インポート' }}
              </button>
              <button class="_button" :class="$style.dataBtn" :disabled="isExporting" @click="exportDb">
                <i class="ti ti-clipboard-copy" />
                {{ isExporting ? '処理中...' : 'エクスポート' }}
              </button>
            </div>
          </div>
          <div :class="$style.dataGroup">
            <span :class="$style.dataGroupLabel"><i class="ti ti-settings" /> 設定バックアップ</span>
            <div :class="$style.dataBtnRow">
              <button class="_button" :class="$style.dataBtn" :disabled="isImportingSettings" @click="importSettings">
                <i class="ti ti-clipboard-text" />
                {{ isImportingSettings ? '処理中...' : 'インポート' }}
              </button>
              <button class="_button" :class="$style.dataBtn" :disabled="isExportingSettings" @click="exportSettings">
                <i class="ti ti-clipboard-copy" />
                {{ isExportingSettings ? '処理中...' : 'エクスポート' }}
              </button>
            </div>
          </div>
          <div v-if="backupError" :class="$style.backupError">{{ backupError }}</div>
        </div>
      </div>

      </div>
    </div>
  </div>

  <!-- Mobile: bottom sheet via native <dialog> -->
  <dialog
    v-if="isCompact && menuVisible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, menuLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <div autofocus tabindex="-1" ref="menuEl" :class="[$style.settingsMenu, $style.mobile, menuLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]" class="_popupMenu" @pointerdown.stop>
      <div :class="$style.menuBody">
      <!-- アピアランス -->
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('appearanceEditor')">
          <i class="ti ti-brush" />
          <span>アピアランス</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>

      <!-- 環境設定 (フラットに展開) -->
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('aiSettings')">
          <i class="ti ti-robot" />
          <span>AI</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('performanceEditor')">
          <i class="ti ti-gauge" />
          <span>パフォーマンス</span>
          <span v-if="Object.keys(perfStore.overrides).length > 0" :class="$style.activeDot" />
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('cssEditor')">
          <i class="ti ti-code" />
          <span>カスタムCSS</span>
          <span v-if="themeStore.customCss" :class="$style.activeDot" />
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('tasksEditor')">
          <i class="ti ti-player-play" />
          <span>タスク</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('snippetsEditor')">
          <i class="ti ti-code-plus" />
          <span>スニペット</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>

      <!-- データ -->
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('backup')">
          <i class="ti ti-database" />
          <span>バックアップ</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>
      <div :class="$style.categorySection">
        <button :class="$style.categoryHeader" @click="openToolWindow('cacheEditor')">
          <i class="ti ti-eraser" />
          <span>キャッシュ</span>
          <i class="ti ti-chevron-right" :class="$style.chevronNav" />
        </button>
      </div>

      </div>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.menuBackdrop {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup) !important;
}

.settingsMenu {
  z-index: calc(var(--nd-z-popup) + 1) !important;
  bottom: 100%;
  right: 0;
  margin-bottom: 4px;
  width: 260px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.menuBody {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  min-height: 0;
}

/* -- Category accordion -- */

.categorySection {
  border-bottom: 1px solid var(--nd-divider);
}

.categoryHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 12px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.7;
  border: none;
  background: none;
  cursor: pointer;
  transition: opacity var(--nd-duration-fast), background var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-accent-hover);
  }
}

.categoryBody {
  padding-bottom: 4px;
}

.chevron {
  margin-left: auto;
  font-size: 0.9em;
  transition: transform var(--nd-duration-base);
  transform: rotate(-90deg);
}

.chevronOpen {
  transform: rotate(0deg);
}

.chevronNav {
  margin-left: auto;
  font-size: 0.9em;
  opacity: 0.5;
}

.activeDot + .chevronNav {
  margin-left: 0;
}

/* -- Custom CSS -- */

.activeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nd-accent);
  margin-left: auto;
}

/* -- Menu items (wallpaper etc.) -- */

.settingsMenuItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 12px;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 0.85em;
  line-height: 20px;
  color: var(--nd-fg);
  text-align: left;
  position: relative;

  &::before {
    content: '';
    display: block;
    position: absolute;
    inset: 2px 8px;
    border-radius: var(--nd-radius-sm);
    transition: background var(--nd-duration-fast);
  }

  &:hover::before {
    background: var(--nd-accent-hover);
  }

  i {
    position: relative;
  }
}

.settingsMenuDivider {
  height: 1px;
  background: var(--nd-divider);
  margin: 4px 0;
}

.dataGroup {
  padding: 4px 16px;
}

.dataGroupLabel {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8em;
  color: var(--nd-fg);
  margin-bottom: 4px;
}

.cacheSummary {
  margin-left: auto;
  font-size: 0.85em;
  color: var(--nd-fgMuted, var(--nd-fgTransparentWeak));
  font-variant-numeric: tabular-nums;
  font-weight: normal;
}

.dataBtnRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.backupError {
  padding: 2px 16px;
  font-size: 0.75em;
  color: var(--nd-error, #ec4137);
}

.dataBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  font-size: 0.75em;
  font-weight: bold;
  color: var(--nd-fg);
  transition: background var(--nd-duration-base), color var(--nd-duration-base);
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.settingsMenuLabel {
  position: relative;
}

/* Mobile bottom sheet — used inside <dialog class="_nativeDialog"> */
.mobile {
  &.settingsMenu {
    position: static;
    width: 100%;
    max-width: none;
    min-width: 0;
    margin: 0;
    bottom: auto;
    right: auto;
    border-radius: 16px 16px 0 0;
    background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
    max-height: 80vh;
    padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));

    &:focus,
    &:focus-visible {
      outline: none;
    }
  }

  .settingsMenuItem {
    padding: 8px 12px;
    min-height: 44px;
  }

  .categoryHeader {
    padding: 8px 12px;
    min-height: 44px;
  }

  .categorySection:last-child {
    border-bottom: none;
  }
}

</style>
