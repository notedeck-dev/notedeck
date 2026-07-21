<script setup lang="ts">
import { ref, watch } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import MkMediaLightbox from '@/components/common/MkMediaLightbox.vue'
import PopupMenu from '@/components/common/PopupMenu.vue'
import { useDriveActions } from '@/composables/useDriveActions'
import type { PendingUpload } from '@/composables/useFileAttachment'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { usePrompt } from '@/stores/prompt'

/**
 * 投稿フォームの添付ファイルプレビュー列 (#707 MkPostForm 分割)。
 * #753 で本家 Misskey の添付 UX に追従: ドラッグで並び替え、タイルクリックで
 * メニュー (名前変更 / センシティブ / キャプション / プレビュー / 取り消し /
 * 削除)。センシティブは半透明オーバーレイで表示。
 * 状態操作はすべて emit で親 (usePostFormState) に委ねる。
 */
const props = defineProps<{
  files: NormalizedDriveFile[]
  pending: PendingUpload[]
  /** ドライブからの完全削除に使用 */
  accountId: string
}>()

const emit = defineEmits<{
  remove: [fileId: string]
  retry: [key: string]
  dismiss: [key: string]
  reorder: [fromIndex: number, toIndex: number]
  updateMeta: [
    fileId: string,
    patch: { comment?: string | null; isSensitive?: boolean; name?: string },
  ]
}>()

const { prompt } = usePrompt()
const driveActions = useDriveActions()

// --- ドラッグ並び替え (本家はドラッグソート。ボタン式は廃止) ---
const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'file-idx',
  onReorder: (from, to) => emit('reorder', from, to),
})

// ドラッグ後に発火する click でメニューが開かないよう 1 回だけ抑制する
let suppressClick = false
watch(dragFromIndex, (v, old) => {
  if (old != null && v == null) {
    suppressClick = true
    setTimeout(() => {
      suppressClick = false
    }, 0)
  }
})

// --- ファイルメニュー ---
const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const menuFile = ref<NormalizedDriveFile | null>(null)

function onTileClick(file: NormalizedDriveFile, e: MouseEvent) {
  if (suppressClick) return
  menuFile.value = file
  popupMenuRef.value?.open(e)
}

// キーボード操作 (Enter) はタイル下辺中央をメニュー位置にする
// (PopupMenu.open は clientX/Y で位置決めするため)
function onTileKeydown(file: NormalizedDriveFile, e: KeyboardEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  menuFile.value = file
  popupMenuRef.value?.open({
    currentTarget: el,
    target: el,
    clientX: rect.left + rect.width / 2,
    clientY: rect.bottom - 10,
  } as unknown as MouseEvent)
}

function closeMenu() {
  popupMenuRef.value?.close()
}

async function onRename() {
  closeMenu()
  const file = menuFile.value
  if (!file) return
  const name = (
    await prompt({ title: 'ファイル名を変更', defaultValue: file.name })
  )?.trim()
  if (!name || name === file.name) return
  emit('updateMeta', file.id, { name })
}

function onToggleSensitive() {
  closeMenu()
  const file = menuFile.value
  if (!file) return
  emit('updateMeta', file.id, { isSensitive: !file.isSensitive })
}

async function onEditCaption() {
  closeMenu()
  const file = menuFile.value
  if (!file) return
  const caption = await prompt({
    title: 'キャプション',
    message: '視覚に障害のあるユーザーなどに向けたファイルの説明を設定できます',
    placeholder: 'ファイルの説明',
    defaultValue: file.comment ?? '',
    multiline: true,
    allowEmpty: true,
  })
  if (caption === null || caption === (file.comment ?? '')) return
  emit('updateMeta', file.id, { comment: caption || null })
}

// --- プレビュー (画像のみ、lightbox) ---
const lightboxIndex = ref<number | null>(null)
const imageFiles = ref<NormalizedDriveFile[]>([])

function onPreview() {
  closeMenu()
  const file = menuFile.value
  if (!file) return
  const images = props.files.filter((f) => f.type.startsWith('image/'))
  const idx = images.findIndex((f) => f.id === file.id)
  if (idx < 0) return
  imageFiles.value = images
  lightboxIndex.value = idx
}

function onDetach() {
  closeMenu()
  const file = menuFile.value
  if (!file) return
  emit('remove', file.id)
}

async function onDelete() {
  closeMenu()
  const file = menuFile.value
  if (!file) return
  // 確認ダイアログは deleteFile 側が出す
  if (await driveActions.deleteFile(props.accountId, file)) {
    emit('remove', file.id)
  }
}
</script>

<template>
  <div :class="$style.filePreviewArea">
    <div
      v-for="(file, i) in files"
      :key="file.id"
      :data-file-idx="i"
      :class="[
        $style.filePreview,
        {
          [$style.dragging]: dragFromIndex === i,
          [$style.dragOver]: dragOverIndex === i,
        },
      ]"
      role="button"
      tabindex="0"
      :title="file.name"
      @pointerdown="startDrag(i, $event)"
      @click="onTileClick(file, $event)"
      @keydown.enter.prevent="onTileKeydown(file, $event)"
    >
      <img
        v-if="file.thumbnailUrl || file.type.startsWith('image/')"
        :src="file.thumbnailUrl || file.url"
        :class="$style.fileThumb"
        draggable="false"
      />
      <div v-else :class="$style.fileIcon">
        <i class="ti ti-file-text" />
      </div>
      <!-- 本家同様、センシティブは半透明オーバーレイ + アイコンを中央表示 -->
      <div v-if="file.isSensitive" :class="$style.sensitiveOverlay">
        <i class="ti ti-eye-off" />
      </div>
    </div>

    <!-- アップロード中 / 失敗 (per-file #753) -->
    <div
      v-for="p in pending"
      :key="p.key"
      :class="[$style.fileUploading, { [$style.uploadError]: p.status === 'error' }]"
      :title="p.status === 'error' ? (p.error ?? p.name) : p.name"
    >
      <template v-if="p.status === 'uploading'">
        <i class="ti ti-loader-2 nd-spin" />
      </template>
      <template v-else>
        <div :class="$style.errorActions">
          <button
            class="_button"
            :class="$style.errorBtn"
            title="再試行"
            @click="emit('retry', p.key)"
          >
            <i class="ti ti-refresh" />
          </button>
          <button
            class="_button"
            :class="$style.errorBtn"
            title="破棄"
            @click="emit('dismiss', p.key)"
          >
            <i class="ti ti-x" />
          </button>
        </div>
      </template>
    </div>

    <PopupMenu ref="popupMenuRef">
      <button class="_popupItem" @click="onRename">
        <i class="ti ti-pencil" />
        ファイル名を変更
      </button>
      <button class="_popupItem" @click="onToggleSensitive">
        <i :class="menuFile?.isSensitive ? 'ti ti-eye' : 'ti ti-eye-off'" />
        {{ menuFile?.isSensitive ? 'センシティブを解除' : 'センシティブとして設定' }}
      </button>
      <button class="_popupItem" @click="onEditCaption">
        <i class="ti ti-text-caption" />
        {{ menuFile?.comment ? 'キャプションを編集' : 'キャプションを付ける' }}
      </button>
      <button
        v-if="menuFile?.type.startsWith('image/')"
        class="_popupItem"
        @click="onPreview"
      >
        <i class="ti ti-photo" />
        プレビュー
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem" @click="onDetach">
        <i class="ti ti-x" />
        添付を取り消す
      </button>
      <button class="_popupItem _popupItemDanger" @click="onDelete">
        <i class="ti ti-trash" />
        削除
      </button>
    </PopupMenu>

    <MkMediaLightbox
      v-if="lightboxIndex != null"
      :files="imageFiles"
      :initial-index="lightboxIndex"
      @close="lightboxIndex = null"
    />
  </div>
</template>

<style lang="scss" module>
.filePreviewArea {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 24px;
}

.filePreview {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: var(--nd-radius-md);
  overflow: hidden;
  background: var(--nd-buttonBg);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--nd-focus);
    outline-offset: 2px;
  }

  &.dragging {
    opacity: 0.4;
  }

  &.dragOver {
    outline: 2px solid var(--nd-accent);
  }
}

.fileThumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.fileIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--nd-fg);
  opacity: 0.5;
}

.sensitiveOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 18px;
  pointer-events: none;
}

.fileUploading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-buttonBg);
  font-size: 0.8em;
  opacity: 0.7;
}

.uploadError {
  opacity: 1;
  outline: 1px solid var(--nd-error);
  color: var(--nd-error);
}

.errorActions {
  display: flex;
  gap: 2px;
}

.errorBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--nd-radius-sm);
  color: inherit;

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}
</style>
