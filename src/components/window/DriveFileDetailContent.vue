<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { normalizeDriveFile } from '@/adapters/misskey/api/drive'
import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import DriveItemMenu from '@/components/common/DriveItemMenu.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkDriveFolderSelectDialog from '@/components/common/MkDriveFolderSelectDialog.vue'
import MkMediaLightbox from '@/components/common/MkMediaLightbox.vue'
import { useDriveActions } from '@/composables/useDriveActions'
import {
  formatFileSize,
  isAudio,
  isImage,
  isVideo,
  safeUrl,
} from '@/composables/useDriveFolder'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

const props = defineProps<{
  accountId: string
  fileId: string
  /** ウィンドウを開いたカラムの現在フォルダ（移動ダイアログの開始位置） */
  originFolderId?: string | null
  originStack?: DriveFolder[]
}>()

const emit = defineEmits<{
  close: []
}>()

const driveActions = useDriveActions()
const uiStore = useUiStore()

const file = ref<NormalizedDriveFile | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function fetchFile() {
  error.value = null
  try {
    const raw = unwrap(
      await commands.apiGetDriveFile(props.accountId, {
        fileId: props.fileId,
      } as never),
    )
    file.value = normalizeDriveFile(raw as never)
  } catch (e) {
    error.value = AppError.from(e).message
  } finally {
    loading.value = false
  }
}

// リネーム等の bump に追従して表示を更新する。
// 注意: setup store の分割代入はリアクティビティを失い watch が発火しない
watch(
  () => uiStore.driveFilesChanged,
  (sig) => {
    if (sig.accountId === props.accountId) {
      fetchFile()
    }
  },
)

// reveal 状態は fileId をキーに保持し、再取得で file オブジェクトが
// 差し替わっても維持する（reveal 直後のリネームで再 blur されない）
const revealedIds = shallowRef(new Set<string>())
const revealed = computed(() => revealedIds.value.has(props.fileId))

function toggleReveal() {
  const next = new Set(revealedIds.value)
  if (next.has(props.fileId)) {
    next.delete(props.fileId)
  } else {
    next.add(props.fileId)
  }
  revealedIds.value = next
}

const blurred = computed(() => !!file.value?.isSensitive && !revealed.value)

// --- Lightbox (画像のみ。動画は inline controls のまま — §8-33) ---
const lightboxOpen = ref(false)

function onImageClick() {
  if (!file.value || blurred.value) return
  lightboxOpen.value = true
}

// --- Menu / move / delete ---
const itemMenuRef = ref<InstanceType<typeof DriveItemMenu>>()
const moveDialogOpen = ref(false)

function openMenu(e: MouseEvent) {
  itemMenuRef.value?.open(e)
}

async function onMoveConfirm(folderId: string | null) {
  moveDialogOpen.value = false
  if (!file.value) return
  await driveActions.moveFiles(props.accountId, [file.value.id], folderId)
}

fetchFile()
</script>

<template>
  <div :class="$style.root">
    <div v-if="loading" :class="$style.loading"><LoadingSpinner /></div>
    <ColumnEmptyState v-else-if="error" :message="error" is-error />
    <template v-else-if="file">
      <div :class="$style.header">
        <div :class="$style.titleRow">
          <div :class="$style.title">{{ file.name }}</div>
          <button
            class="_button"
            :class="$style.menuBtn"
            aria-label="メニュー"
            title="メニュー"
            @click="openMenu"
          >
            <i class="ti ti-dots" />
          </button>
        </div>
        <div :class="$style.meta">
          <span>{{ file.type }}</span>
          <span>{{ formatFileSize(file.size) }}</span>
          <span v-if="file.isSensitive" :class="$style.sensitiveBadge">
            <i class="ti ti-eye-off" /> NSFW
          </span>
        </div>
      </div>

      <div :class="$style.body">
        <div :class="$style.preview">
          <template v-if="isImage(file)">
            <img
              :src="safeUrl(file.url)"
              :alt="file.name"
              :class="[$style.previewImage, { [$style.blurred]: blurred, [$style.zoomable]: !blurred }]"
              @click="onImageClick"
            />
            <div v-if="blurred" class="_sensitiveOverlay" @click.stop="toggleReveal">
              <i class="ti ti-eye-off" />
              <span>NSFW</span>
            </div>
            <button
              v-if="file.isSensitive && revealed"
              class="_button"
              :class="$style.hideBtn"
              title="隠す"
              @click.stop="toggleReveal"
            >
              <i class="ti ti-eye" />
            </button>
          </template>
          <template v-else-if="isVideo(file)">
            <video
              v-if="!blurred"
              :src="safeUrl(file.url)"
              :class="$style.previewVideo"
              controls
            />
            <div v-else :class="$style.previewPlaceholder" />
            <div v-if="blurred" class="_sensitiveOverlay" @click.stop="toggleReveal">
              <i class="ti ti-eye-off" />
              <span>NSFW</span>
            </div>
            <button
              v-if="file.isSensitive && revealed"
              class="_button"
              :class="$style.hideBtn"
              title="隠す"
              @click.stop="toggleReveal"
            >
              <i class="ti ti-eye" />
            </button>
          </template>
          <audio
            v-else-if="isAudio(file)"
            :src="safeUrl(file.url)"
            controls
            :class="$style.previewAudio"
          />
          <div v-else :class="$style.previewPlaceholder">
            <i class="ti ti-file" />
          </div>
        </div>
        <div v-if="file.comment" :class="$style.comment">{{ file.comment }}</div>
      </div>

      <DriveItemMenu
        ref="itemMenuRef"
        kind="file"
        :item="file"
        :account-id="accountId"
        context="detail"
        @move-request="moveDialogOpen = true"
        @deleted="emit('close')"
      />

      <MkMediaLightbox
        v-if="lightboxOpen"
        :files="[file]"
        :initial-index="0"
        @close="lightboxOpen = false"
      />

      <MkDriveFolderSelectDialog
        v-if="moveDialogOpen"
        :account-id="accountId"
        :initial-folder-id="originFolderId ?? null"
        :initial-stack="originStack"
        @confirm="onMoveConfirm"
        @cancel="moveDialogOpen = false"
      />
    </template>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 32px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 1.05em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  word-break: break-all;
}

.menuBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8em;
  opacity: 0.7;
}

.sensitiveBadge {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--nd-love);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.preview {
  position: relative;
  border-radius: var(--nd-radius-md);
  overflow: hidden;
  background: var(--nd-bg);
}

.previewImage {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
}

.zoomable {
  cursor: zoom-in;
}

.blurred {
  filter: blur(var(--nd-blur));
}

.previewVideo {
  display: block;
  width: 100%;
  max-height: 420px;
}

.previewAudio {
  display: block;
  width: 100%;
  padding: 16px;
}

.previewPlaceholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-size: 48px;
  opacity: 0.2;
}

.hideBtn {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-modalBg);
  color: #fff;
  z-index: 2;
}

.comment {
  font-size: 0.85em;
  opacity: 0.8;
  white-space: pre-wrap;
  line-height: 1.5;
}
</style>
