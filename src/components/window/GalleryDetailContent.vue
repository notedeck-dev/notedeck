<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import MkMediaLightbox from '@/components/common/MkMediaLightbox.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { safeUrl } from '@/composables/useDriveFolder'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { webUiUrl } from '@/utils/url'

interface GalleryFile {
  id: string
  name: string
  type: string
  url: string
  thumbnailUrl: string | null
  isSensitive: boolean
}

interface GalleryPost {
  id: string
  title: string
  description: string | null
  fileIds: string[]
  files: GalleryFile[]
  isSensitive: boolean
  likedCount: number
  isLiked: boolean
  createdAt: string
  user: {
    id: string
    username: string
    name: string | null
    avatarUrl: string | null
    host: string | null
    emojis?: Record<string, string>
  }
}

const props = defineProps<{
  accountId: string
  postId: string
  post: GalleryPost
}>()

const accountsStore = useAccountsStore()
const account = computed(
  () => accountsStore.accounts.find((a) => a.id === props.accountId) ?? null,
)
const serverUrl = computed(() =>
  account.value ? webUiUrl(account.value.host) : '',
)

const detailPost = ref<GalleryPost>({ ...props.post })
const detailImageIndex = ref(0)
const liking = ref(false)

const currentFile = computed(
  () => detailPost.value.files[detailImageIndex.value] ?? null,
)

const galleryWebUrl = computed(() => {
  if (!serverUrl.value) return undefined
  return `${serverUrl.value}/gallery/${props.postId}`
})

useWindowExternalLink(() =>
  galleryWebUrl.value ? { url: galleryWebUrl.value } : null,
)

function isImage(file: GalleryFile): boolean {
  return file.type.startsWith('image/')
}

// --- Sensitive: blur + click-to-reveal (#793: #792 のドライブ詳細と同じ契約) ---
// reveal 状態は fileId をキーに保持する
const revealedIds = shallowRef(new Set<string>())

function isRevealed(file: GalleryFile): boolean {
  return revealedIds.value.has(file.id)
}

function isBlurred(file: GalleryFile): boolean {
  return file.isSensitive && !isRevealed(file)
}

function toggleReveal(file: GalleryFile) {
  const next = new Set(revealedIds.value)
  if (next.has(file.id)) {
    next.delete(file.id)
  } else {
    next.add(file.id)
  }
  revealedIds.value = next
}

// --- Lightbox: 画像クリックで拡大 (#793: MkMediaLightbox 再利用) ---
const lightboxIndex = ref<number | null>(null)

const previewableImages = computed<NormalizedDriveFile[]>(() =>
  detailPost.value.files.filter(isImage).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    url: f.url,
    thumbnailUrl: f.thumbnailUrl,
    size: 0,
    isSensitive: f.isSensitive,
    comment: null,
    width: null,
    height: null,
    blurhash: null,
  })),
)

function openLightbox(file: GalleryFile) {
  if (isBlurred(file)) return
  const idx = previewableImages.value.findIndex((f) => f.id === file.id)
  if (idx >= 0) lightboxIndex.value = idx
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function prevImage() {
  if (detailImageIndex.value > 0) {
    detailImageIndex.value--
  }
}

function nextImage() {
  if (detailImageIndex.value < detailPost.value.files.length - 1) {
    detailImageIndex.value++
  }
}

async function toggleLike() {
  if (liking.value) return
  liking.value = true
  try {
    if (detailPost.value.isLiked) {
      unwrap(
        await commands.apiUnlikeGalleryPost(
          props.accountId,
          detailPost.value.id,
        ),
      )
    } else {
      unwrap(
        await commands.apiLikeGalleryPost(props.accountId, detailPost.value.id),
      )
    }
    detailPost.value.isLiked = !detailPost.value.isLiked
    detailPost.value.likedCount += detailPost.value.isLiked ? 1 : -1
  } catch {
    // ignore
  } finally {
    liking.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') {
    prevImage()
  } else if (e.key === 'ArrowRight') {
    nextImage()
  }
}
</script>

<template>
  <div :class="$style.root" tabindex="-1" @keydown="onKeydown">
    <div :class="$style.scroll">
      <div :class="$style.viewer">
        <template v-if="currentFile">
          <div :class="$style.viewerImage">
            <template v-if="isImage(currentFile)">
              <img
                :src="safeUrl(currentFile.url)"
                :alt="currentFile.name"
                :class="[$style.viewerImg, { [$style.blurred]: isBlurred(currentFile), [$style.zoomable]: !isBlurred(currentFile) }]"
                @click="openLightbox(currentFile)"
              />
              <div v-if="isBlurred(currentFile)" class="_sensitiveOverlay" @click.stop="toggleReveal(currentFile)">
                <i class="ti ti-eye-off" />
                <span>NSFW</span>
              </div>
              <button
                v-if="currentFile.isSensitive && isRevealed(currentFile)"
                class="_button"
                :class="$style.hideBtn"
                title="隠す"
                @click.stop="toggleReveal(currentFile)"
              >
                <i class="ti ti-eye" />
              </button>
            </template>
            <div v-else :class="$style.placeholder">
              <i class="ti ti-file" />
            </div>
          </div>
          <template v-if="detailPost.files.length > 1">
            <button
              v-if="detailImageIndex > 0"
              class="_button"
              :class="[$style.navBtn, $style.navPrev]"
              @click="prevImage"
            >
              <i class="ti ti-chevron-left" />
            </button>
            <button
              v-if="detailImageIndex < detailPost.files.length - 1"
              class="_button"
              :class="[$style.navBtn, $style.navNext]"
              @click="nextImage"
            >
              <i class="ti ti-chevron-right" />
            </button>
            <div :class="$style.dots">
              <span
                v-for="(_, i) in detailPost.files"
                :key="i"
                :class="[$style.dot, { [$style.active]: i === detailImageIndex }]"
                @click="detailImageIndex = i"
              />
            </div>
          </template>
        </template>
      </div>

      <div :class="$style.info">
        <div :class="$style.title">{{ detailPost.title }}</div>
        <div v-if="detailPost.description" :class="$style.desc">{{ detailPost.description }}</div>
        <div :class="$style.meta">
          <div :class="$style.user">
            <img
              :src="detailPost.user.avatarUrl || '/avatar-default.svg'"
              :class="$style.userAvatar"
              @error="(e: Event) => (e.target as HTMLImageElement).src = '/avatar-error.svg'"
            />
            <span :class="$style.userName">
              <MkMfm v-if="detailPost.user.name" :text="detailPost.user.name" :emojis="detailPost.user.emojis" :server-host="account?.host" plain />
              <template v-else>{{ detailPost.user.username }}</template>
            </span>
          </div>
          <span :class="$style.date">{{ formatDate(detailPost.createdAt) }}</span>
        </div>
        <div :class="$style.actions">
          <button
            class="_button"
            :class="[$style.likeBtn, { [$style.liked]: detailPost.isLiked }]"
            :disabled="liking"
            @click="toggleLike"
          >
            <i class="ti ti-heart" />
            <span v-if="detailPost.likedCount > 0">{{ detailPost.likedCount }}</span>
          </button>
        </div>
      </div>
    </div>

    <MkMediaLightbox
      v-if="lightboxIndex !== null"
      :files="previewableImages"
      :initial-index="lightboxIndex"
      @close="lightboxIndex = null"
    />
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  outline: none;
}

.scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.viewer {
  position: relative;
  background: var(--nd-bg);
}

.viewerImage {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
}

.viewerImg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.zoomable {
  cursor: zoom-in;
}

.blurred {
  filter: blur(var(--nd-blur));
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

.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 32px;
  opacity: 0.3;

  span {
    font-size: 14px;
  }
}

.navBtn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--nd-modalBg);
  color: #fff;
  font-size: 16px;
  transition: background var(--nd-duration-base);

  &:hover {
    background: rgba(0, 0, 0, 0.7);
  }
}

.navPrev {
  left: 8px;
}

.navNext {
  right: 8px;
}

.dots {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &.active {
    background: #fff;
  }
}

.info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.title {
  font-size: 1em;
  font-weight: 700;
  color: var(--nd-fgHighlighted);
}

.desc {
  font-size: 0.85em;
  color: var(--nd-fg);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.user {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.userAvatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
}

.userName {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date {
  font-size: 0.8em;
  opacity: 0.5;
  flex-shrink: 0;
}

.actions {
  display: flex;
  gap: 8px;
}

.likeBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-love-subtle);
  color: var(--nd-fg);
  font-size: 0.85em;
  font-weight: 600;
  transition: background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    background: color-mix(in srgb, var(--nd-love) 20%, transparent);
  }

  &.liked {
    color: var(--nd-love);
    background: var(--nd-love-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.liked {
  /* used as modifier */
}
</style>
