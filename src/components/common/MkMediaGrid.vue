<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import { blurhashToDataUrl } from '@/utils/blurhashDataUrl'
import { isSafeUrl, openSafeUrl } from '@/utils/url'
import MkMediaLightbox from './MkMediaLightbox.vue'

function safeMediaSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return isSafeUrl(url) ? url : undefined
}

const props = defineProps<{
  files: NormalizedDriveFile[]
  /** When true, load images eagerly (item is near viewport in virtual scroller) */
  eager?: boolean
}>()

const revealedIds = shallowRef(new Set<string>())
const loadedIds = shallowRef(new Set<string>())
const erroredIds = shallowRef(new Set<string>())
const lightboxIndex = ref<number | null>(null)

function isImage(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('image/')
}

function isVideo(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('video/')
}

function isAudio(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('audio/')
}

function isAnimatedImage(file: NormalizedDriveFile): boolean {
  return file.type === 'image/gif' || file.type === 'image/apng'
}

function isPreviewable(file: NormalizedDriveFile): boolean {
  return isImage(file) || isVideo(file)
}

const previewableFiles = computed(() => props.files.filter(isPreviewable))
const audioFiles = computed(() => props.files.filter(isAudio))
const otherFiles = computed(() =>
  props.files.filter((f) => !isPreviewable(f) && !isAudio(f)),
)
const previewableCount = computed(() => {
  const c = previewableFiles.value.length
  return c <= 4 ? c : 'many'
})

// 単一メディアは寸法が分かる場合に aspect-ratio を予約して、
// ロード完了時にセルの高さが伸びるレイアウトシフトを防ぐ
// (max-height の clamp は CSS 側でそのまま効く)
const singleMediaStyle = computed(() => {
  if (previewableFiles.value.length !== 1) return undefined
  const f = previewableFiles.value[0]
  if (!f?.width || !f?.height) return undefined
  return { aspectRatio: `${f.width} / ${f.height}` }
})

function blurhashPlaceholder(file: NormalizedDriveFile): string | null {
  if (!file.blurhash || loadedIds.value.has(file.id)) return null
  return blurhashToDataUrl(file.blurhash)
}

function onImageLoaded(fileId: string) {
  const next = new Set(loadedIds.value)
  next.add(fileId)
  loadedIds.value = next
}

function onImageError(fileId: string) {
  const next = new Set(erroredIds.value)
  next.add(fileId)
  erroredIds.value = next
}

function toggleSensitive(file: NormalizedDriveFile, e: Event) {
  e.stopPropagation()
  const next = new Set(revealedIds.value)
  if (next.has(file.id)) {
    next.delete(file.id)
  } else {
    next.add(file.id)
  }
  revealedIds.value = next
}

function openLightbox(file: NormalizedDriveFile, e: Event) {
  e.stopPropagation()
  if (file.isSensitive && !revealedIds.value.has(file.id)) return
  const idx = previewableFiles.value.indexOf(file)
  if (idx >= 0) lightboxIndex.value = idx
}

function closeLightbox() {
  lightboxIndex.value = null
}
</script>

<template>
  <!-- Banner: Audio files (outside grid, like Misskey's MkMediaBanner) -->
  <div v-for="file in audioFiles" :key="file.id" :class="$style.mediaBanner">
    <div v-if="file.isSensitive && !revealedIds.has(file.id)" :class="$style.bannerSensitive" @click="toggleSensitive(file, $event)">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
            stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <b>NSFW</b>
      <span>{{ file.name }}</span>
    </div>
    <div v-else :class="$style.bannerAudio">
      <audio controls preload="metadata" :class="$style.audioPlayer" @click.stop>
        <source :src="safeMediaSrc(file.url)">
      </audio>
      <span :class="$style.audioName">{{ file.name }}</span>
    </div>
  </div>

  <!-- Banner: Other files (download link, like Misskey's MkMediaBanner) -->
  <div v-for="file in otherFiles" :key="file.id" :class="$style.mediaBanner">
    <button :class="$style.bannerDownload" @click.stop="openSafeUrl(file.url)">
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <b>{{ file.name }}</b>
    </button>
  </div>

  <!-- Grid: Previewable files only (image + video) -->
  <div v-if="previewableFiles.length > 0" :class="[$style.mediaGrid, $style[`mediaCount${previewableCount}`]]" :style="singleMediaStyle">
    <div
      v-for="file in previewableFiles"
      :key="file.id"
      :class="[$style.mediaCell, { [$style.isSensitive]: file.isSensitive && !revealedIds.has(file.id), [$style.isLoaded]: loadedIds.has(file.id) || erroredIds.has(file.id) }]"
      @click="openLightbox(file, $event)"
    >
      <img
        v-if="blurhashPlaceholder(file)"
        :src="blurhashPlaceholder(file)!"
        :class="$style.blurhashPlaceholder"
        alt=""
        aria-hidden="true"
      />
      <template v-if="isImage(file)">
        <img
          v-if="!erroredIds.has(file.id)"
          :src="safeMediaSrc(file.thumbnailUrl) || safeMediaSrc(file.url)"
          :alt="file.name"
          :class="[$style.mediaImage, { [$style.isLoaded]: loadedIds.has(file.id) }]"
          :loading="props.eager ? 'eager' : 'lazy'"
          decoding="async"
          @load="onImageLoaded(file.id)"
          @error="onImageError(file.id)"
        />
        <div v-else :class="$style.mediaPlaceholder">
          <i class="ti ti-photo" />
        </div>
      </template>
      <template v-else-if="isVideo(file)">
        <video
          v-if="!erroredIds.has(file.id)"
          :src="safeMediaSrc(file.url)"
          :class="$style.mediaVideo"
          preload="metadata"
          controls
          @click.stop
          @loadeddata="onImageLoaded(file.id)"
          @error="onImageError(file.id)"
        />
        <div v-else :class="$style.mediaPlaceholder">
          <i class="ti ti-video" />
        </div>
      </template>

      <!-- NSFW overlay -->
      <div
        v-if="file.isSensitive && !revealedIds.has(file.id)"
        class="_sensitiveOverlay"
        @click.stop="toggleSensitive(file, $event)"
      >
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
              stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>NSFW</span>
      </div>

      <!-- Indicators (GIF / ALT / Sensitive) -->
      <div v-if="!file.isSensitive || revealedIds.has(file.id)" :class="$style.indicators">
        <span v-if="isAnimatedImage(file)" :class="$style.indicator">GIF</span>
        <span v-if="file.comment" :class="$style.indicator">ALT</span>
        <span v-if="file.isSensitive" :class="$style.indicatorWarn">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </span>
      </div>

      <!-- Revealed: show hide button -->
      <button
        v-if="file.isSensitive && revealedIds.has(file.id)"
        :class="$style.sensitiveHideBtn"
        @click.stop="toggleSensitive(file, $event)"
      >
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" fill="none" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none" />
        </svg>
      </button>

    </div>
  </div>

  <!-- Lightbox (共通コンポーネントに抽出 — #792 §2.6) -->
  <MkMediaLightbox
    v-if="lightboxIndex !== null"
    :files="previewableFiles"
    :initial-index="lightboxIndex"
    @close="closeLightbox"
  />
</template>

<style lang="scss" module>
/* Banner: Audio & Other files (like Misskey's MkMediaBanner) */
.mediaBanner {
  margin-top: 8px;
  border-radius: var(--nd-radius-md);
  overflow: hidden;
  border: 0.5px solid var(--nd-border, rgba(128, 128, 128, 0.2));
}

.bannerAudio {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
}

.audioPlayer {
  width: 100%;
  height: 32px;
}

.audioName {
  font-size: 0.75em;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bannerSensitive {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #111;
  color: #fff;
  font-size: 0.8em;
  cursor: pointer;

  span {
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.bannerDownload {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 0.8em;
  color: var(--nd-fg);
  text-decoration: none;
  border: none;
  background: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;

  b {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &:hover {
    background: var(--nd-bg-hover, rgba(128, 128, 128, 0.1));
  }
}

/* Grid: Image + Video */
.mediaGrid {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  contain: content;
  container-type: inline-size;
}

.mediaCount1 {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
  min-height: 64px;
  max-height: clamp(64px, 50cqh, min(360px, 50vh));
}

.mediaCount2 {
  aspect-ratio: 16 / 9;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr;
}

.mediaCount3 {
  aspect-ratio: 16 / 9;
  grid-template-columns: 1fr 0.5fr;
  grid-template-rows: 1fr 1fr;

  > .mediaCell:first-child {
    grid-row: 1 / 3;
  }

  > .mediaCell:nth-child(3) {
    grid-column: 2 / 3;
    grid-row: 2 / 3;
  }
}

.mediaCount4 {
  aspect-ratio: 16 / 9;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.mediaCountmany {
  grid-template-columns: 1fr 1fr;

  > .mediaCell {
    aspect-ratio: 16 / 9;
  }
}

.mediaCell {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  cursor: pointer;
  background: var(--nd-bg, rgba(0, 0, 0, 0.05));
  contain: layout;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 25%, rgba(255, 255, 255, 0.08) 50%, transparent 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    z-index: 0;
  }

  &.isLoaded::before {
    display: none;
  }
}

/* blurhash: 実画像ロードまでの間、シマーの上・実画像の下に敷く */
.blurhashPlaceholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}

.mediaImage {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  content-visibility: auto;
  opacity: 0;
  transform: scale(0.98);
  transition: opacity var(--nd-duration-slower) var(--nd-ease-spring),
    transform var(--nd-duration-slower) var(--nd-ease-spring),
    filter var(--nd-duration-slow) var(--nd-ease-decel);
  position: relative;
  z-index: 1;

  &.isLoaded {
    opacity: 1;
    transform: none;
  }
}

.mediaVideo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mediaPlaceholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  opacity: 0.3;
  font-size: 2em;
}

/* NSFW overlay */
.isSensitive {
  .mediaImage,
  .mediaVideo {
    filter: blur(var(--nd-blur));
  }
}

/* Indicators (GIF / ALT / Sensitive) */
.indicators {
  display: inline-flex;
  position: absolute;
  top: 10px;
  left: 10px;
  pointer-events: none;
  opacity: 0.5;
  gap: 6px;
  z-index: 2;
}

.indicator {
  background-color: black;
  border-radius: 6px;
  color: var(--nd-accent, #86b300);
  display: inline-block;
  font-weight: bold;
  font-size: 0.8em;
  padding: 2px 5px;
}

.indicatorWarn {
  background-color: black;
  border-radius: 6px;
  color: var(--nd-warn, #c44);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 5px;
}

.sensitiveHideBtn {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-modalBg);
  color: #fff;
  cursor: pointer;
  z-index: 2;
  transition: background var(--nd-duration-base);

  &:hover {
    background: rgba(0, 0, 0, 0.7);
  }
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@container (max-width: 500px) {
  .mediaGrid {
    gap: 4px;
  }

  .mediaCell {
    border-radius: 6px;
  }
}
</style>
