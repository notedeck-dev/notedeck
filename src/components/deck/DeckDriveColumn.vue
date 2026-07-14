<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkFileGrid from '@/components/common/MkFileGrid.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import {
  formatFileSize,
  isAudio,
  isImage,
  isVideo,
  safeUrl,
  useDriveFolder,
} from '@/composables/useDriveFolder'
import { useServerImages } from '@/composables/useServerImages'
import { getAccountAvatarUrl } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)
const isLoggedOut = computed(() => account.value?.hasToken === false)

const {
  currentFolderId,
  folderStack,
  folders,
  files,
  loading,
  error,
  fetchDrive,
  openFolder: _openFolder,
  goUp: _goUp,
  goRoot: _goRoot,
  selectedIds,
  toggleFile,
  selectAll,
  deselectAll,
} = useDriveFolder({
  accountId: () => props.column.accountId ?? undefined,
  initialFolderId: props.column.folderId,
})

const deckStore = useDeckStore()

// Report visible drive files to deckStore (汎用 visibleItems API)
watch(
  files,
  (items) => {
    deckStore.reportVisibleItems(props.column.id, items)
  },
  { immediate: true },
)

// --- Detail view ---
const detailFile = ref<NormalizedDriveFile | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function openFolder(folder: Parameters<typeof _openFolder>[0]) {
  detailFile.value = null
  _openFolder(folder)
}

function goUp() {
  if (detailFile.value) {
    detailFile.value = null
    deleteError.value = null
    return
  }
  _goUp()
}

function goRoot() {
  detailFile.value = null
  deleteError.value = null
  _goRoot()
}

function openDetail(file: NormalizedDriveFile) {
  detailFile.value = file
  deleteError.value = null
}

const { confirm } = useConfirm()

async function deleteFile() {
  if (!detailFile.value || !props.column.accountId || deleting.value) return
  const ok = await confirm({
    title: 'ファイルを削除',
    message: `「${detailFile.value.name}」をドライブから削除しますか？このファイルを添付したノートからも消えます。この操作は取り消せません。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok || !detailFile.value || !props.column.accountId) return
  deleting.value = true
  deleteError.value = null
  try {
    unwrap(
      await commands.apiDeleteDriveFile(
        props.column.accountId,
        detailFile.value.id,
      ),
    )
    files.value = files.value.filter((f) => f.id !== detailFile.value?.id)
    detailFile.value = null
  } catch (e) {
    deleteError.value = AppError.from(e).message
  } finally {
    deleting.value = false
  }
}

const driveGridScrollRef = useTemplateRef<HTMLElement>('driveGridScrollRef')
const driveDetailScrollRef = useTemplateRef<HTMLElement>('driveDetailScrollRef')
useColumnPullScroller(driveGridScrollRef)

function scrollToTop() {
  const el = detailFile.value
    ? driveDetailScrollRef.value
    : driveGridScrollRef.value
  el?.scrollTo({ top: 0, behavior: 'smooth' })
}

const canGoUp = computed(() => {
  return detailFile.value !== null || folderStack.value.length > 0
})

// --- Selection mode ---
const selectMode = ref(false)

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) {
    deselectAll()
  }
}

const batchDeleting = ref(false)
const batchDeleteError = ref<string | null>(null)

async function batchDelete() {
  if (
    !props.column.accountId ||
    batchDeleting.value ||
    selectedIds.value.size === 0
  )
    return
  const count = selectedIds.value.size
  const ok = await confirm({
    title: 'ファイルを一括削除',
    message: `選択中の ${count} 件のファイルをドライブから削除しますか？添付したノートからも消えます。この操作は取り消せません。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok || batchDeleting.value) return
  batchDeleting.value = true
  batchDeleteError.value = null
  const idsToDelete = [...selectedIds.value]
  try {
    for (const fileId of idsToDelete) {
      unwrap(await commands.apiDeleteDriveFile(props.column.accountId, fileId))
      files.value = files.value.filter((f) => f.id !== fileId)
    }
    deselectAll()
    selectMode.value = false
  } catch (e) {
    batchDeleteError.value = AppError.from(e).message
  } finally {
    batchDeleting.value = false
  }
}

function onFileClick(file: NormalizedDriveFile) {
  if (selectMode.value) {
    toggleFile(file.id)
  } else {
    openDetail(file)
  }
}

// --- File upload ---
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function openFilePicker() {
  fileInput.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length || !props.column.accountId) return
  uploading.value = true
  try {
    for (const file of input.files) {
      const buf = await file.arrayBuffer()
      unwrap(
        await commands.apiUploadFile(
          props.column.accountId,
          file.name,
          [...new Uint8Array(buf)],
          file.type || 'application/octet-stream',
          false,
          currentFolderId.value,
        ),
      )
    }
    fetchDrive()
  } finally {
    uploading.value = false
    input.value = ''
  }
}

// Listen for external drive-files-changed signal (e.g. from file drop)
const { driveFilesChanged } = useUiStore()
watch(
  () => driveFilesChanged,
  (sig) => {
    if (sig.accountId === props.column.accountId) {
      fetchDrive()
    }
  },
)

// Initial load
fetchDrive()
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? 'ドライブ'" :theme-vars="columnThemeVars" :pull-refresh="fetchDrive" @header-click="scrollToTop" @refresh="fetchDrive()">
    <template #header-icon>
      <i class="ti ti-cloud" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <button v-if="canGoUp" class="_button" :class="$style.headerRefresh" title="戻る" @click.stop="goUp">
        <i class="ti ti-arrow-left" />
      </button>
      <button v-if="folderStack.length > 1" class="_button" :class="$style.headerRefresh" title="ルート" @click.stop="goRoot">
        <i class="ti ti-home" />
      </button>
      <button v-if="!detailFile" class="_button" :class="[$style.headerRefresh, { [$style.headerBtnActive]: selectMode }]" title="選択" @click.stop="toggleSelectMode">
        <i class="ti ti-checkbox" />
      </button>
      <button v-if="!detailFile && !selectMode" class="_button" :class="$style.headerRefresh" title="アップロード" :disabled="uploading" @click.stop="openFilePicker">
        <i class="ti ti-upload" />
      </button>
      <div v-if="account" :class="$style.headerAccount">
        <img :src="getAccountAvatarUrl(account)" :class="$style.headerAvatar" />
      </div>
    </template>

    <input
      ref="fileInput"
      type="file"
      multiple
      style="display: none"
      @change="onFileSelected"
    />

    <!-- Detail view -->
    <template v-if="detailFile">
      <div ref="driveDetailScrollRef" :class="$style.driveDetailScroll">
        <div :class="$style.driveDetail">
          <div :class="$style.driveDetailPreview">
            <img
              v-if="isImage(detailFile)"
              :src="safeUrl(detailFile.url)"
              :alt="detailFile.name"
              :class="$style.driveDetailImage"
            />
            <video
              v-else-if="isVideo(detailFile)"
              :src="safeUrl(detailFile.url)"
              :class="$style.driveDetailVideo"
              controls
            />
            <audio
              v-else-if="isAudio(detailFile)"
              :src="safeUrl(detailFile.url)"
              controls
              :class="$style.driveDetailAudio"
            />
            <div v-else :class="$style.driveDetailPlaceholder">
              <i class="ti ti-file" />
            </div>
          </div>
          <div :class="$style.driveDetailInfo">
            <div :class="$style.driveDetailName">{{ detailFile.name }}</div>
            <div :class="$style.driveDetailMeta">
              <span>{{ detailFile.type }}</span>
              <span>{{ formatFileSize(detailFile.size) }}</span>
            </div>
            <div v-if="detailFile.isSensitive" :class="$style.driveDetailSensitive">
              <i class="ti ti-eye-off" /> NSFW
            </div>
          </div>
          <div :class="$style.driveDetailActions">
            <button
              class="_button"
              :class="$style.driveDeleteBtn"
              :disabled="deleting"
              @click="deleteFile"
            >
              <i class="ti ti-trash" />
              {{ deleting ? '削除中...' : '削除' }}
            </button>
          </div>
          <div v-if="deleteError" :class="$style.driveDetailError">{{ deleteError }}</div>
        </div>
      </div>
    </template>

    <!-- Grid view -->
    <template v-else>
      <!-- Breadcrumb -->
      <div v-if="folderStack.length > 0" :class="$style.driveBreadcrumb">
        <button class="_button" :class="$style.driveBreadcrumbItem" @click="goRoot">
          <i class="ti ti-cloud" />
        </button>
        <template v-for="(folder, i) in folderStack" :key="folder.id">
          <i class="ti ti-chevron-right" :class="$style.driveBreadcrumbSep" />
          <button
            class="_button"
            :class="[$style.driveBreadcrumbItem, { [$style.current]: i === folderStack.length - 1 }]"
            @click="i < folderStack.length - 1 ? openFolder(folder) : undefined"
          >
            {{ folder.name }}
          </button>
        </template>
      </div>

      <div ref="driveGridScrollRef" :class="$style.driveGridScroll">
        <div v-if="loading && !isLoggedOut" :class="$style.columnLoading"><LoadingSpinner /></div>
        <ColumnEmptyState v-else-if="error && !isLoggedOut" :message="error" is-error :image-url="serverErrorImageUrl" />
        <template v-else-if="!isLoggedOut">
          <!-- Folders -->
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="_button"
            :class="$style.driveFolderItem"
            @click="openFolder(folder)"
          >
            <i class="ti ti-folder" :class="$style.driveFolderIcon" />
            <span :class="$style.driveFolderName">{{ folder.name }}</span>
            <i class="ti ti-chevron-right" :class="$style.driveFolderArrow" />
          </button>

          <!-- File grid -->
          <MkFileGrid
            :files="files"
            :select-mode="selectMode"
            :selected-ids="selectedIds"
            @file-click="onFileClick"
          >
            <button
              v-if="!selectMode"
              class="_button"
              :class="$style.driveUploadCell"
              :disabled="uploading"
              @click="openFilePicker"
            >
              <div :class="$style.driveUploadThumb">
                <i v-if="uploading" class="ti ti-loader-2 nd-spin" />
                <i v-else class="ti ti-plus" />
              </div>
              <div :class="$style.driveUploadLabel">アップロード</div>
            </button>
          </MkFileGrid>
        </template>
      </div>

      <!-- Selection action bar -->
      <div v-if="selectMode" :class="$style.driveActionBar">
        <div :class="$style.driveActionInfo">
          <button class="_button" :class="$style.driveActionSelectAll" @click="selectedIds.size === files.length ? deselectAll() : selectAll()">
            {{ selectedIds.size === files.length ? '全解除' : '全選択' }}
          </button>
          <span :class="$style.driveActionCount">{{ selectedIds.size }}件選択</span>
        </div>
        <div v-if="batchDeleteError" :class="$style.driveActionError">{{ batchDeleteError }}</div>
        <button
          class="_button"
          :class="$style.driveActionDelete"
          :disabled="selectedIds.size === 0 || batchDeleting"
          @click="batchDelete"
        >
          <i class="ti ti-trash" />
          {{ batchDeleting ? '削除中...' : '削除' }}
        </button>
      </div>
    </template>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';
/* --- Breadcrumb --- */
.driveBreadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.driveBreadcrumbItem {
  font-size: 0.75em;
  color: var(--nd-accent);
  white-space: nowrap;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.current {
    color: var(--nd-fg);
    cursor: default;
  }
}

.driveBreadcrumbSep {
  font-size: 10px;
  opacity: 0.3;
  flex-shrink: 0;
}

/* --- Grid scroll --- */
.driveGridScroll {
  composes: columnScroller from './column-common.module.scss';
  position: relative;
}

/* --- Folder items --- */
.driveFolderItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid var(--nd-divider);
  transition: background var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 50px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.driveFolderIcon {
  font-size: 20px;
  color: var(--nd-accent);
  flex-shrink: 0;
}

.driveFolderName {
  flex: 1;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.driveFolderArrow {
  font-size: 14px;
  opacity: 0.3;
  flex-shrink: 0;
}

/* --- Upload cell (file grid is provided by MkFileGrid) --- */
.driveUploadCell {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: opacity var(--nd-duration-base);

  &:hover .driveUploadThumb {
    opacity: 1;
    background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  }

  &:disabled .driveUploadThumb {
    opacity: 0.3;
  }
}

.driveUploadThumb {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: var(--nd-accent);
  opacity: 0.6;
  border: 2px dashed var(--nd-accent);
  border-radius: var(--nd-radius-md);
  background: color-mix(in srgb, var(--nd-accent) 5%, transparent);
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);
}

.driveUploadLabel {
  padding: 4px 6px;
  font-size: 0.65em;
  color: var(--nd-fg);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}


/* --- Detail view --- */
.driveDetailScroll {
  composes: columnScroller from './column-common.module.scss';
}

.driveDetail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.driveDetailPreview {
  border-radius: var(--nd-radius-md);
  overflow: hidden;
  background: var(--nd-bg);
}

.driveDetailImage {
  display: block;
  width: 100%;
  max-height: 400px;
  object-fit: contain;
}

.driveDetailVideo {
  display: block;
  width: 100%;
  max-height: 400px;
}

.driveDetailAudio {
  display: block;
  width: 100%;
  padding: 16px;
}

.driveDetailPlaceholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-size: 48px;
  opacity: 0.2;
}

.driveDetailInfo {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.driveDetailName {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  word-break: break-all;
}

.driveDetailMeta {
  display: flex;
  gap: 12px;
  font-size: 0.8em;
  opacity: 0.6;
}

.driveDetailSensitive {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: var(--nd-love);
}

.driveDetailActions {
  display: flex;
  gap: 8px;
}

.driveDeleteBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-love-hover);
  color: var(--nd-love);
  font-size: 0.85em;
  font-weight: 600;
  transition: background var(--nd-duration-base);

  &:hover {
    background: color-mix(in srgb, var(--nd-love) 25%, transparent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.driveDetailError {
  font-size: 0.8em;
  color: var(--nd-love);
}

/* --- Selection mode --- */
.headerBtnActive {
  color: var(--nd-accent);
  opacity: 1;
}

.driveActionBar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--nd-divider);
  background: var(--nd-panelBg);
}

.driveActionInfo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.driveActionCount {
  font-size: 0.8em;
  opacity: 0.6;
}

.driveActionSelectAll {
  font-size: 0.8em;
  color: var(--nd-accent);
  padding: 4px 8px;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.driveActionDelete {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-love-hover);
  color: var(--nd-love);
  font-size: 0.8em;
  font-weight: 600;
  transition: background var(--nd-duration-base);

  &:hover {
    background: color-mix(in srgb, var(--nd-love) 25%, transparent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.driveActionError {
  font-size: 0.75em;
  color: var(--nd-love);
  flex: 1;
  text-align: center;
}
</style>
