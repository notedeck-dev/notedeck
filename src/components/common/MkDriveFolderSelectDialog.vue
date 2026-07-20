<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DriveFolder } from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkFolderGrid from '@/components/common/MkFolderGrid.vue'
import { useBackButton } from '@/composables/useBackButton'
import { useDriveActions } from '@/composables/useDriveActions'
import { useDriveFolder } from '@/composables/useDriveFolder'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useThemeStore } from '@/stores/theme'
import { AUTH_ERROR_MESSAGE } from '@/utils/errors'

const props = defineProps<{
  accountId: string
  /** 開始フォルダ（未指定はルート開始） */
  initialFolderId?: string | null
  initialStack?: DriveFolder[]
}>()

const emit = defineEmits<{
  confirm: [folderId: string | null]
  cancel: []
}>()

const LEAVE_DURATION = 200

const themeStore = useThemeStore()
const themeVars = computed(() =>
  themeStore.getStyleVarsForAccount(props.accountId),
)

// カラム側のナビ状態を汚さない独立インスタンス
const {
  currentFolderId,
  folderStack,
  folders,
  loading,
  error,
  fetchDrive,
  openFolder,
  goUp,
  goRoot,
} = useDriveFolder({
  accountId: () => props.accountId,
  initialFolderId: props.initialFolderId ?? null,
  initialStack: props.initialStack,
})

const driveActions = useDriveActions()

const show = ref(true)
const { visible, entering, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: LEAVE_DURATION,
})

const dialogRef = ref<HTMLDialogElement | null>(null)

function close(result: 'cancel' | 'confirm') {
  if (!show.value) return
  show.value = false
  const folderId = currentFolderId.value
  setTimeout(() => {
    if (result === 'confirm') emit('confirm', folderId)
    else emit('cancel')
  }, LEAVE_DURATION)
}

useNativeDialog(dialogRef, visible, {
  onCancel: () => close('cancel'),
  leaveDuration: LEAVE_DURATION,
})

// Android 戻るボタンは即 close（階層 up にしない — §8-8）
useBackButton(show, () => close('cancel'))

const currentName = computed(
  () => folderStack.value[folderStack.value.length - 1]?.name ?? null,
)

async function onCreateFolder() {
  const created = await driveActions.createFolder(
    props.accountId,
    currentFolderId.value,
  )
  // レスポンス由来で auto-descend（同階層 51 個以上でも壊れない）
  if (created) openFolder(created)
}

fetchDrive()
</script>

<template>
  <dialog
    v-if="visible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[entering && $style.enter, leaving && $style.leave]"
  >
    <div
      class="_dialog nd-popup-content"
      :class="[$style.dialog, entering && $style.contentEnter, leaving && $style.contentLeave]"
      :style="themeVars"
    >
      <!-- Header: 戻る + ルート + 現在フォルダ名 + 新規フォルダ -->
      <div :class="$style.header">
        <button v-if="folderStack.length > 0" class="_button" :class="$style.headerBtn" title="戻る" @click="goUp">
          <i class="ti ti-arrow-left" />
        </button>
        <button v-if="folderStack.length > 0" class="_button" :class="$style.headerBtn" title="ルート" @click="goRoot">
          <i class="ti ti-home" />
        </button>
        <span :class="$style.title">
          <i :class="currentName ? 'ti ti-folder' : 'ti ti-cloud'" />
          {{ currentName ?? 'ドライブ' }}
        </span>
        <button class="_button" :class="$style.headerBtn" title="新規フォルダ" aria-label="新規フォルダ" @click="onCreateFolder">
          <i class="ti ti-folder-plus" />
        </button>
      </div>

      <!-- Body: フォルダ一覧（クリック = 潜る） -->
      <div :class="$style.body">
        <div v-if="loading" :class="$style.empty"><LoadingSpinner /></div>
        <div v-else-if="error" :class="[$style.empty, $style.error]">{{ error.isAuth ? AUTH_ERROR_MESSAGE : error.message }}</div>
        <MkFolderGrid v-else :folders="folders" @folder-click="openFolder" />
      </div>

      <!-- Footer: 押す前に行き先がわかる確定ラベル -->
      <div :class="$style.actions">
        <button type="button" class="_button" :class="$style.btnCancel" @click="close('cancel')">
          キャンセル
        </button>
        <button type="button" class="_button" :class="$style.btnOk" @click="close('confirm')">
          <span :class="$style.btnOkLabel">{{ currentName ? `「${currentName}」に移動` : 'ルートに移動' }}</span>
        </button>
      </div>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/popup';

.dialog {
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px 8px;
  flex-shrink: 0;
}

.headerBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.title {
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

.body {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
  padding: 0 8px;
  --mk-file-grid-columns: repeat(3, 1fr);
}

.empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 0.85em;
  opacity: 0.5;
}

.error {
  color: var(--nd-love);
  opacity: 1;
}

.actions {
  display: flex;
  gap: 6px;
  padding: 12px 16px 16px;
  justify-content: flex-end;
  flex-shrink: 0;
}

.btnCancel { @include btn-secondary; }
.btnOk { @include btn-primary; }

.btnOkLabel {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
