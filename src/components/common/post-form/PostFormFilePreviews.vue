<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import type { PendingUpload } from '@/composables/useFileAttachment'

/**
 * 投稿フォームの添付ファイルプレビュー列 (#707 MkPostForm 分割)。
 * #753 で per-file 進捗・失敗リトライ・並べ替え・alt/センシティブ編集に対応。
 * 状態操作はすべて emit で親 (usePostFormState) に委ねる。
 */
const props = defineProps<{
  files: NormalizedDriveFile[]
  pending: PendingUpload[]
}>()

const emit = defineEmits<{
  remove: [fileId: string]
  retry: [key: string]
  dismiss: [key: string]
  move: [fileId: string, delta: -1 | 1]
  updateMeta: [
    fileId: string,
    patch: { comment?: string | null; isSensitive?: boolean },
  ]
}>()

// タイルをクリックすると下に alt / センシティブの編集パネルを開く
const selectedFileId = ref<string | null>(null)
const selectedFile = computed(
  () => props.files.find((f) => f.id === selectedFileId.value) ?? null,
)
const altDraft = ref('')

function toggleSelect(file: NormalizedDriveFile) {
  if (selectedFileId.value === file.id) {
    selectedFileId.value = null
    return
  }
  selectedFileId.value = file.id
  altDraft.value = file.comment ?? ''
}

// 削除などで選択中ファイルが消えたらパネルを閉じる
watch(
  () => selectedFile.value,
  (file) => {
    if (!file) selectedFileId.value = null
  },
)

function commitAlt() {
  const file = selectedFile.value
  if (!file) return
  const next = altDraft.value.trim()
  if (next === (file.comment ?? '')) return
  emit('updateMeta', file.id, { comment: next || null })
}

function toggleSensitive(file: NormalizedDriveFile) {
  emit('updateMeta', file.id, { isSensitive: !file.isSensitive })
}
</script>

<template>
  <div>
    <div :class="$style.filePreviewArea">
      <div
        v-for="file in files"
        :key="file.id"
        :class="[$style.filePreview, { [$style.selected]: file.id === selectedFileId }]"
        role="button"
        tabindex="0"
        :title="file.name"
        @click="toggleSelect(file)"
        @keydown.enter.prevent="toggleSelect(file)"
      >
        <img
          v-if="file.thumbnailUrl || file.type.startsWith('image/')"
          :src="file.thumbnailUrl || file.url"
          :class="[$style.fileThumb, { [$style.thumbSensitive]: file.isSensitive }]"
        />
        <div v-else :class="$style.fileIcon">
          <i class="ti ti-file-text" />
        </div>
        <button
          class="_button"
          :class="$style.fileRemove"
          title="削除"
          @click.stop="emit('remove', file.id)"
        >
          <i class="ti ti-x" />
        </button>
        <span
          v-if="file.isSensitive"
          :class="$style.sensitiveBadge"
          title="センシティブ"
        >
          <i class="ti ti-eye-off" />
        </span>
        <span
          v-if="file.comment"
          :class="$style.altBadge"
          :title="`ALT: ${file.comment}`"
        >ALT</span>
      </div>

      <!-- アップロード中 / 失敗 (per-file #753) -->
      <div
        v-for="p in pending"
        :key="p.key"
        :class="[$style.fileUploading, { [$style.uploadError]: p.status === 'error' }]"
        :title="p.status === 'error' ? (p.error ?? p.name) : p.name"
      >
        <template v-if="p.status === 'uploading'">
          <i class="ti ti-loader-2" :class="$style.spin" />
          <span :class="$style.pendingName">{{ p.name }}</span>
        </template>
        <template v-else>
          <span :class="$style.pendingName">{{ p.name }}</span>
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
    </div>

    <!-- alt / センシティブ / 並べ替えの編集パネル -->
    <div v-if="selectedFile" :class="$style.fileEditor">
      <input
        v-model="altDraft"
        :class="$style.altInput"
        placeholder="代替テキスト (ALT)"
        @blur="commitAlt"
        @keydown.enter.prevent="commitAlt"
      />
      <label :class="$style.sensitiveLabel">
        <input
          type="checkbox"
          :checked="selectedFile.isSensitive"
          @change="toggleSensitive(selectedFile)"
        />
        センシティブ
      </label>
      <div :class="$style.orderButtons">
        <button
          class="_button"
          :class="$style.orderBtn"
          title="左へ移動"
          :disabled="files[0]?.id === selectedFile.id"
          @click="emit('move', selectedFile.id, -1)"
        >
          <i class="ti ti-arrow-left" />
        </button>
        <button
          class="_button"
          :class="$style.orderBtn"
          title="右へ移動"
          :disabled="files[files.length - 1]?.id === selectedFile.id"
          @click="emit('move', selectedFile.id, 1)"
        >
          <i class="ti ti-arrow-right" />
        </button>
      </div>
    </div>
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
  width: 80px;
  height: 80px;
  border-radius: var(--nd-radius-md);
  overflow: hidden;
  background: var(--nd-buttonBg);
  cursor: pointer;

  &.selected {
    outline: 2px solid var(--nd-accent);
  }
}

.fileThumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbSensitive {
  filter: blur(6px);
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

.fileRemove {
  position: absolute;
  top: 0;
  right: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--nd-overlayDark);
  color: #fff;
  cursor: pointer;
}

.sensitiveBadge {
  position: absolute;
  bottom: 2px;
  left: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-overlayDark);
  color: #fff;
  font-size: 12px;
}

.altBadge {
  position: absolute;
  bottom: 2px;
  right: 2px;
  padding: 1px 4px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-overlayDark);
  color: #fff;
  font-size: 0.6em;
  font-weight: bold;
}

.fileUploading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 80px;
  height: 80px;
  padding: 4px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-buttonBg);
  font-size: 0.7em;
  opacity: 0.7;
}

.uploadError {
  opacity: 1;
  outline: 1px solid var(--nd-error);
  color: var(--nd-error);
}

.spin {
  animation: file-upload-spin 1s linear infinite;
}

@keyframes file-upload-spin {
  to {
    transform: rotate(360deg);
  }
}

.pendingName {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.fileEditor {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 0 24px 8px;
}

.altInput {
  flex: 1;
  min-width: 160px;
  padding: 6px 10px;
  font-size: 0.85em;
  font-family: inherit;
  color: var(--nd-fg);
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  outline: none;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.35;
  }
}

.sensitiveLabel {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;
}

.orderButtons {
  display: flex;
  gap: 2px;
}

.orderBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.7;

  &:hover:not(:disabled) {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }

  &:disabled {
    opacity: 0.25;
    cursor: default;
  }
}
</style>
