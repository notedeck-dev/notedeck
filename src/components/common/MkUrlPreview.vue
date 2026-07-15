<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  triggerRef,
  watch,
} from 'vue'
import { useNoteAccountId } from '@/composables/useNoteContext'
import { useOgpPreview } from '@/composables/useOgpPreview'
import { usePerformanceStore } from '@/stores/performance'
import { proxyUrl } from '@/utils/imageProxy'
import { parseNoteUrl } from '@/utils/noteUrl'
import { isSafeUrl, openSafeUrl } from '@/utils/url'

const perfStore = usePerformanceStore()

const MkNoteEmbed = defineAsyncComponent(() => import('./MkNoteEmbed.vue'))

const props = defineProps<{
  url: string
}>()

const accountId = useNoteAccountId()

const mediaExtRe =
  /\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|mp3|ogg|wav)(\?.*)?$/i

const isNoteUrl = computed(() => parseNoteUrl(props.url) !== null)

const shouldPreview = computed(() => {
  if (!isSafeUrl(props.url)) return false
  if (mediaExtRe.test(props.url)) return false
  if (isNoteUrl.value) return false
  return true
})

const { data, loading, fetch, fetchUrl } = useOgpPreview(props.url, accountId)
const el = ref<HTMLElement | null>(null)
const imageError = ref(false)
const sensitiveRevealed = ref(false)
const playerExpanded = ref(false)
const galleryErrors = shallowRef(new Set<number>())

// When virtual scroller recycles this component with a new URL, re-fetch
watch(
  () => props.url,
  (newUrl) => {
    imageError.value = false
    sensitiveRevealed.value = false
    playerExpanded.value = false
    galleryErrors.value = new Set()
    fetchUrl(newUrl)
  },
)

const galleryImages = computed(() => {
  if (!data.value?.medias?.length || data.value.medias.length < 2) return []
  return data.value.medias.slice(0, perfStore.get('ogpGalleryMax'))
})

function onGalleryError(index: number) {
  galleryErrors.value.add(index)
  triggerRef(galleryErrors)
}
let observer: IntersectionObserver | null = null

/** Check if player URL is allowed (HTTPS only, trusted from backend) */
const isPlayerAllowed = computed(() => {
  if (!data.value?.player?.url) return false
  try {
    const url = new URL(data.value.player.url)
    return url.protocol === 'https:'
  } catch {
    return false
  }
})

/** Responsive player style: width always 100%, height from oEmbed or default */
const playerStyle = computed(() => {
  const h = data.value?.player?.height ?? 270
  return { width: '100%', height: `${h}px`, border: 'none' }
})

onMounted(() => {
  if (!shouldPreview.value || !el.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        observer?.disconnect()
        observer = null
        fetch()
      }
    },
    { rootMargin: `${perfStore.get('lazyLoadMargin')}px` },
  )
  observer.observe(el.value)
})

onUnmounted(() => {
  observer?.disconnect()
})

function handleClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const targetUrl = data.value?.url || props.url
  openSafeUrl(targetUrl)
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
</script>

<template>
  <MkNoteEmbed v-if="isNoteUrl" :url="url" />
  <div v-else-if="shouldPreview" ref="el" :class="[$style.urlPreview, !loading && 'nd-content-appear']" @click="handleClick">
    <!-- 実カード (サムネイル 100px + body のタイトル/説明/ホスト行) と同じ
         構造・寸法にして、差し替え時の高さジャンプを防ぐ -->
    <div v-if="loading" :class="$style.urlPreviewSkeleton">
      <div :class="$style.skeletonThumb" />
      <div :class="$style.urlPreviewBody">
        <div :class="$style.skeletonLine" style="width: 60%" />
        <div :class="[$style.skeletonLine, $style.skeletonLineDesc]" style="width: 80%" />
        <div :class="[$style.skeletonLine, $style.skeletonLineHost]" style="width: 40%" />
      </div>
    </div>

    <template v-else-if="data?.title">
      <!-- Player embed (click thumbnail to expand) -->
      <div
        v-if="playerExpanded && data.player && isPlayerAllowed"
        :class="$style.urlPreviewPlayer"
      >
        <iframe
          :src="data.player.url"
          :style="playerStyle"
          frameborder="0"
          :allow="data.player.allow.length ? data.player.allow.join('; ') : 'autoplay; encrypted-media'"
          allowfullscreen
        />
      </div>

      <!-- Multi-image gallery (2-4 images) -->
      <div
        v-else-if="galleryImages.length >= 2"
        :class="[
          $style.urlPreviewGallery,
          {
            [String($style.isSensitive)]: data.sensitive && !sensitiveRevealed,
            [String($style[`gallery${galleryImages.length}`])]: true,
          },
        ]"
      >
        <img
          v-for="(media, i) in galleryImages"
          :key="i"
          :src="proxyUrl(media) ?? media"
          :class="$style.galleryImage"
          loading="lazy"
          decoding="async"
          @error="onGalleryError(i)"
        />
        <div
          v-if="data.sensitive && !sensitiveRevealed"
          :class="$style.urlSensitive"
          class="_sensitiveOverlay"
          @click.stop="sensitiveRevealed = true"
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
            />
          </svg>
          <span>NSFW</span>
        </div>
      </div>

      <!-- Thumbnail with sensitive overlay -->
      <div
        v-else-if="(data.thumbnail || (!data.thumbnail && data.icon)) && !imageError"
        :class="[
          $style.urlPreviewThumbWrap,
          {
            [$style.isSensitive]: data.sensitive && !sensitiveRevealed,
            [$style.isIconThumb]: !data.thumbnail && data.icon,
          },
        ]"
      >
        <img
          :src="data.thumbnail ? (proxyUrl(data.thumbnail) ?? data.thumbnail) : data.icon!"
          :class="[$style.urlPreviewImage, { [$style.isIcon]: !data.thumbnail }]"
          loading="lazy"
          decoding="async"
          @error="imageError = true"
          @click.stop="
            data.player && isPlayerAllowed
              ? (playerExpanded = true)
              : undefined
          "
        />
        <!-- Sensitive overlay -->
        <div
          v-if="data.sensitive && !sensitiveRevealed"
          :class="$style.urlSensitive"
          class="_sensitiveOverlay"
          @click.stop="sensitiveRevealed = true"
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
            />
          </svg>
          <span>NSFW</span>
        </div>
        <!-- Play indicator for player-capable previews -->
        <div
          v-if="data.player && isPlayerAllowed && !data.sensitive"
          :class="$style.playIndicator"
          @click.stop="playerExpanded = true"
        >
          <svg viewBox="0 0 24 24" width="32" height="32">
            <path fill="currentColor" d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      <div :class="$style.urlPreviewBody">
        <div :class="$style.urlPreviewTitle">{{ data.title }}</div>
        <div
          v-if="data.description"
          :class="$style.urlPreviewDescription"
        >
          {{ data.description }}
        </div>
        <div :class="$style.urlPreviewHost">
          <img
            v-if="data.icon"
            :src="data.icon"
            :class="$style.urlPreviewFavicon"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          {{ hostname(data.url || url) }}
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.urlPreview {
  display: flex;
  font-size: 14px;
  box-shadow: 0 0 0 1px var(--nd-divider);
  border-radius: var(--nd-radius-md);
  overflow: clip;
  cursor: pointer;
  background: var(--nd-panelHighlight);
  max-width: 100%;

  &:has(.urlPreviewPlayer),
  &:has(.urlPreviewGallery) {
    flex-direction: column;
  }

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.urlPreviewThumbWrap {
  position: relative;
  flex-shrink: 0;
  width: 100px;
  min-height: 80px;

  &.isIconThumb {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--nd-buttonBg);
  }

  &.isSensitive .urlPreviewImage {
    filter: blur(var(--nd-blur));
  }
}

.urlPreviewImage {
  width: 100%;
  height: 100%;
  object-fit: cover;

  &.isIcon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
  }
}

/* Gallery grid */
.urlPreviewGallery {
  position: relative;
  display: grid;
  gap: 2px;
  max-height: 200px;
  overflow: hidden;

  &.isSensitive .galleryImage {
    filter: blur(var(--nd-blur));
  }
}

.gallery2 {
  grid-template-columns: 1fr 1fr;
}

.gallery3 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;

  .galleryImage:first-child {
    grid-row: 1 / -1;
  }
}

.gallery4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.galleryImage {
  width: 100%;
  height: 100%;
  object-fit: cover;
  min-height: 0;
}

.urlSensitive {
  gap: 4px;
  font-size: 0.75em;
}

.playIndicator {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.urlPreviewPlayer {
  flex-shrink: 0;
  width: 100%;

  iframe {
    display: block;
  }
}

.urlPreviewBody {
  padding: 16px;
  min-width: 0;
  flex: 1;
}

.urlPreviewTitle {
  font-size: 1em;
  font-weight: 600;
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.urlPreviewDescription {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.7;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.urlPreviewHost {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.5;
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.urlPreviewFavicon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.urlPreviewSkeleton {
  display: flex;
  width: 100%;
}

.skeletonThumb {
  flex-shrink: 0;
  width: 100px;
  min-height: 80px;
  background: linear-gradient(
    90deg,
    var(--nd-buttonBg) 25%,
    var(--nd-panelHighlight) 50%,
    var(--nd-buttonBg) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeletonLine {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--nd-buttonBg) 25%,
    var(--nd-panelHighlight) 50%,
    var(--nd-buttonBg) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeletonLineDesc {
  height: 11px;
  margin-top: 4px;
}

.skeletonLineHost {
  height: 11px;
  margin-top: 8px;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

@container (max-width: 400px) {
  .urlPreview {
    font-size: 12px;
  }

  .urlPreviewBody {
    padding: 12px;
  }

  .urlPreviewThumbWrap {
    width: 80px;
    min-height: 64px;
  }
}

@container (max-width: 350px) {
  .urlPreview {
    font-size: 10px;
  }

  .urlPreviewBody {
    padding: 8px;
  }

  .urlPreviewHost {
    margin-top: 4px;
  }
}
</style>
