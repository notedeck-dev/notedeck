<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkFileGrid from '@/components/common/MkFileGrid.vue'
import MkFolderGrid from '@/components/common/MkFolderGrid.vue'
import { useDriveFolder } from '@/composables/useDriveFolder'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

const props = defineProps<{
  accountId: string
}>()

const themeStore = useThemeStore()
const themeVars = computed(() =>
  themeStore.getStyleVarsForAccount(props.accountId),
)

const emit = defineEmits<{
  pick: [files: NormalizedDriveFile[]]
  close: []
}>()

const {
  currentFolderId,
  folderStack,
  folders,
  files,
  loading,
  error,
  fetchDrive,
  openFolder,
  goUp,
  selectedIds,
  toggleFile,
  selectedCount,
} = useDriveFolder({ accountId: () => props.accountId })

// --- Upload cell ---
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref<string | null>(null)

function openFilePicker() {
  fileInput.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  uploading.value = true
  uploadError.value = null
  try {
    const uploaded: NormalizedDriveFile[] = []
    for (const file of input.files) {
      const buf = await file.arrayBuffer()
      const result = unwrap(
        await commands.apiUploadFile(
          props.accountId,
          file.name,
          [...new Uint8Array(buf)],
          file.type || 'application/octet-stream',
          false,
          currentFolderId.value,
        ),
      )
      uploaded.push(result as unknown as NormalizedDriveFile)
    }
    await fetchDrive()
    // Auto-select uploaded files so user just taps 添付 to confirm.
    const next = new Set(selectedIds.value)
    for (const f of uploaded) next.add(f.id)
    selectedIds.value = next
  } catch (e) {
    uploadError.value = AppError.from(e).message
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function confirm() {
  const picked = files.value.filter((f) => selectedIds.value.has(f.id))
  if (picked.length > 0) {
    emit('pick', picked)
  }
}

// 開きっぱなしのピッカーが移動 / リネーム後に stale にならないよう追従する。
// 注意: setup store の分割代入はリアクティビティを失い watch が発火しない
const uiStore = useUiStore()
watch(
  () => uiStore.driveFilesChanged,
  (sig) => {
    if (sig.accountId === props.accountId) {
      fetchDrive()
    }
  },
)

// Initial load
fetchDrive()
</script>

<template>
  <div :class="$style.drivePicker" :style="themeVars" @click.stop>
    <!-- Header -->
    <div :class="$style.dpHeader">
      <button v-if="folderStack.length > 0" class="_button" :class="$style.dpHeaderBtn" @click="goUp">
        <i class="ti ti-arrow-left" />
      </button>
      <span :class="$style.dpTitle">
        <i class="ti ti-cloud" />
        {{ folderStack.length > 0 ? folderStack[folderStack.length - 1]!.name : 'ドライブ' }}
      </span>
      <button class="_button" :class="$style.dpHeaderBtn" title="アップロード" aria-label="アップロード" :disabled="uploading" @click="openFilePicker">
        <i :class="uploading ? 'ti ti-loader-2 nd-spin' : 'ti ti-upload'" />
      </button>
      <button
        class="_button"
        :class="$style.dpConfirm"
        :disabled="selectedCount === 0"
        :title="selectedCount === 0 ? 'ファイルを選択' : `${selectedCount}件を添付`"
        @click="confirm"
      >
        添付<span v-if="selectedCount > 0" :class="$style.dpConfirmCount">{{ selectedCount }}</span>
      </button>
      <button class="_button" :class="$style.dpHeaderBtn" title="閉じる" @click="emit('close')">
        <i class="ti ti-x" />
      </button>
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      accept="image/*,video/*,audio/*"
      style="display: none"
      @change="onFileSelected"
    />

    <!-- Content -->
    <div :class="$style.dpContent">
      <div v-if="loading" :class="$style.dpEmpty"><LoadingSpinner /></div>
      <div v-else-if="error" :class="[$style.dpEmpty, $style.dpError]">{{ error }}</div>
      <template v-else>
        <!-- ドライブカラムと同じ連続配置 (3 列固定)。アップロードはヘッダーに集約 -->
        <div :class="$style.dpItemsGrid">
          <MkFolderGrid :folders="folders" flat @folder-click="openFolder" />
          <MkFileGrid
            :files="files"
            select-mode
            :selected-ids="selectedIds"
            :show-label="false"
            flat
            @file-click="(file) => toggleFile(file.id)"
          />
        </div>

        <div v-if="uploadError" :class="$style.dpUploadError">{{ uploadError }}</div>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
.drivePicker {
  width: 100%;
  max-width: 520px;
  max-height: min(75vh, 640px);
  margin: 0 16px 16px;
  display: flex;
  flex-direction: column;
  background: var(--nd-panelBg, var(--nd-popup));
  border-radius: 12px;
  box-shadow: 0 8px 32px var(--nd-shadow);
  overflow: hidden;
}

.dpHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.dpTitle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dpHeaderBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.dpContent {
  flex: 1;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

/* フォルダ + ファイルを 3 列で連続配置（ドライブカラムと同型） */
.dpItemsGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 2px;
}

.dpEmpty {
  padding: 32px 16px;
  text-align: center;
  font-size: 0.85em;
  opacity: 0.5;
}

.dpError {
  color: var(--nd-love);
  opacity: 1;
}

.dpUploadError {
  padding: 8px 12px;
  font-size: 0.75em;
  color: var(--nd-love);
}

.dpConfirm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  font-size: 0.8em;
  font-weight: 600;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.dpConfirmCount {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.25);
  font-size: 0.9em;
  line-height: 16px;
  text-align: center;
}

</style>
