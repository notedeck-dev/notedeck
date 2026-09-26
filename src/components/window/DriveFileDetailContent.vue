<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { normalizeDriveFile } from '@/adapters/misskey/api/drive'
import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'
import type { ExifField } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import DriveItemMenu from '@/components/common/DriveItemMenu.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkDriveFolderSelectDialog from '@/components/common/MkDriveFolderSelectDialog.vue'
import MkMediaLightbox from '@/components/common/MkMediaLightbox.vue'
import { useDriveActions } from '@/composables/useDriveActions'
import {
  isAudio,
  isImage,
  isVideo,
  safeUrl,
} from '@/composables/useDriveFolder'
import { i18n } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { formatBytes } from '@/utils/format'
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
    // EXIF は常時表示欄として自動照会する（画像のみ・初回のみ）
    if (isImage(file.value) && exifFields.value === null) loadExif()
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

// --- EXIF viewer (#797) ---
// オリジナルを再ダウンロードするためオンデマンド読込。目的は
// 「アップロードした原本に位置情報等が残っていないか」の確認
const exifFields = ref<ExifField[] | null>(null)
const exifLoading = ref(false)
const exifError = ref<string | null>(null)

const exifPrimary = computed(() =>
  (exifFields.value ?? []).filter((f) => f.ifd === 'primary'),
)
const exifHasGps = computed(() =>
  exifPrimary.value.some((f) => f.tag.startsWith('GPS')),
)

async function loadExif() {
  if (!file.value || exifLoading.value) return
  exifLoading.value = true
  exifError.value = null
  try {
    exifFields.value = unwrap(await commands.readImageExif(file.value.url))
  } catch (e) {
    exifError.value = AppError.from(e).message
  } finally {
    exifLoading.value = false
  }
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
      <!-- 画像を最上部に、その下にファイル情報、最下部に EXIF (常時表示) -->
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
              :title="i18n.ts._common.hide"
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
              :title="i18n.ts._common.hide"
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

      <div :class="$style.header">
        <div :class="$style.titleRow">
          <div :class="$style.title">{{ file.name }}</div>
          <button
            class="_button"
            :class="$style.menuBtn"
            :aria-label="i18n.ts._common.menu"
            :title="i18n.ts._common.menu"
            @click="openMenu"
          >
            <i class="ti ti-dots" />
          </button>
        </div>
        <div :class="$style.meta">
          <span>{{ file.type }}</span>
          <span>{{ formatBytes(file.size) }}</span>
          <span v-if="file.isSensitive" :class="$style.sensitiveBadge">
            <i class="ti ti-eye-off" /> NSFW
          </span>
        </div>
        <div v-if="file.comment" :class="$style.comment">{{ file.comment }}</div>
      </div>

      <!-- EXIF (#797): 画像のみ。自動照会して常時表示 -->
      <div v-if="isImage(file)" :class="$style.exifSection">
        <div :class="$style.exifHeader">
          <i class="ti ti-list-search" />
          {{ i18n.ts._driveFileDetailContent.exif }}
        </div>
        <div v-if="exifLoading" :class="$style.exifEmpty">
          <i class="ti ti-loader-2 nd-spin" /> {{ i18n.ts._common.loading }}
        </div>
        <div v-else-if="exifError" :class="$style.exifError">{{ exifError }}</div>
        <template v-else-if="exifFields !== null">
          <div v-if="exifHasGps" :class="$style.exifGpsWarning">
            <i class="ti ti-map-pin" />
            {{ i18n.ts._driveFileDetailContent.exifHasGps }}
          </div>
          <div v-if="exifPrimary.length === 0" :class="$style.exifEmpty">
            {{ i18n.ts._driveFileDetailContent.exifEmpty }}
          </div>
          <table v-else :class="$style.exifTable">
            <tbody>
              <tr v-for="(f, i) in exifPrimary" :key="`${f.tag}-${i}`">
                <td :class="$style.exifTag">{{ f.tag }}</td>
                <td :class="$style.exifValue">{{ f.value }}</td>
              </tr>
            </tbody>
          </table>
        </template>
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

/* プレビューは最上部に全幅で表示 */
.preview {
  position: relative;
  overflow: hidden;
  background: var(--nd-bg);
  flex-shrink: 0;
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

/* --- EXIF (#797) --- */
.exifSection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 16px;
}

.exifHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.exifGpsWarning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-love-hover);
  color: var(--nd-love);
  font-size: 0.8em;
  font-weight: 600;
}

.exifEmpty {
  font-size: 0.8em;
  opacity: 0.6;
}

.exifError {
  font-size: 0.8em;
  color: var(--nd-love);
}

.exifTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75em;

  td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--nd-divider);
    vertical-align: top;
  }
}

.exifTag {
  white-space: nowrap;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.exifValue {
  word-break: break-all;
  opacity: 0.85;
}
</style>
