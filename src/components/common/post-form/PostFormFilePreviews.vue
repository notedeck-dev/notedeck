<script setup lang="ts">
import type { NormalizedDriveFile } from '@/adapters/types'

/**
 * 投稿フォームの添付ファイルプレビュー列 (#707 MkPostForm 分割)。
 * 削除は remove emit で親の state 操作に委ねる。
 */
defineProps<{
  files: NormalizedDriveFile[]
  uploading: boolean
}>()

const emit = defineEmits<{
  remove: [fileId: string]
}>()
</script>

<template>
  <div :class="$style.filePreviewArea">
    <div v-for="file in files" :key="file.id" :class="$style.filePreview">
      <img
        v-if="file.thumbnailUrl || file.type.startsWith('image/')"
        :src="file.thumbnailUrl || file.url"
        :class="$style.fileThumb"
      />
      <div v-else :class="$style.fileIcon">
        <i class="ti ti-file-text" />
      </div>
      <button class="_button" :class="$style.fileRemove" title="削除" @click="emit('remove', file.id)">
        <i class="ti ti-x" />
      </button>
    </div>
    <div v-if="uploading" :class="$style.fileUploading">アップロード中...</div>
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
}

.fileThumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.fileUploading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-buttonBg);
  font-size: 0.7em;
  opacity: 0.6;
}
</style>
