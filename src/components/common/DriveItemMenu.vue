<script setup lang="ts">
import { ref } from 'vue'
import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'
import { useDriveActions } from '@/composables/useDriveActions'
import PopupMenu from './PopupMenu.vue'

const props = defineProps<{
  kind: 'file' | 'folder'
  item: NormalizedDriveFile | DriveFolder | null
  accountId: string | null | undefined
  /** detail = 詳細ウィンドウ内（「開く」を出さない） */
  context: 'grid' | 'detail'
}>()

// 「開く」「移動」はホストが状態（origin props / ダイアログ mount）を持つため委譲。
// リネーム・削除はグローバルサービス (usePrompt / useConfirm) で完結するため内部処理 (§8-34)。
const emit = defineEmits<{
  'open-request': [item: NormalizedDriveFile | DriveFolder]
  'move-request': [item: NormalizedDriveFile]
  /** 削除成功通知（詳細ウィンドウの self-close 用） */
  deleted: [item: NormalizedDriveFile]
}>()

const driveActions = useDriveActions()
const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()

function open(e: MouseEvent) {
  popupMenuRef.value?.open(e)
}

function close() {
  popupMenuRef.value?.close()
}

function onOpen() {
  close()
  if (props.item) emit('open-request', props.item)
}

function onRename() {
  close()
  if (!props.item) return
  if (props.kind === 'folder') {
    driveActions.renameFolder(props.accountId, props.item as DriveFolder)
  } else {
    driveActions.renameFile(props.accountId, props.item as NormalizedDriveFile)
  }
}

function onMove() {
  close()
  if (props.item) emit('move-request', props.item as NormalizedDriveFile)
}

async function onDelete() {
  close()
  if (!props.item) return
  if (props.kind === 'folder') {
    await driveActions.deleteFolder(props.accountId, props.item as DriveFolder)
  } else {
    const file = props.item as NormalizedDriveFile
    if (await driveActions.deleteFile(props.accountId, file)) {
      emit('deleted', file)
    }
  }
}

defineExpose({ open, close })
</script>

<template>
  <PopupMenu ref="popupMenuRef">
    <button v-if="context === 'grid'" class="_popupItem" @click="onOpen">
      <i :class="kind === 'folder' ? 'ti ti-folder-open' : 'ti ti-external-link'" />
      開く
    </button>
    <button class="_popupItem" @click="onRename">
      <i class="ti ti-pencil" />
      リネーム
    </button>
    <button v-if="kind === 'file'" class="_popupItem" @click="onMove">
      <i class="ti ti-folder-symlink" />
      移動
    </button>
    <div class="_popupDivider" />
    <button class="_popupItem _popupItemDanger" @click="onDelete">
      <i class="ti ti-trash" />
      削除
    </button>
    <!-- 将来の register_drive_file_action はここに getPluginHandlers computed +
         v-for セクションを足す（NoteMoreMenu と同型の拡張点） -->
  </PopupMenu>
</template>
