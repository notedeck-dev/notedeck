<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import { useBackButton } from '@/composables/useBackButton'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useLongPress } from '@/composables/useLongPress'
import { usePinchZoom } from '@/composables/usePinchZoom'
import { usePortal } from '@/composables/usePortal'
import { useSwipeTab } from '@/composables/useSwipeTab'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { isSafeUrl, openSafeUrl } from '@/utils/url'
import PopupMenu from './PopupMenu.vue'

// MkMediaGrid から抽出した共通ライトボックス (#792 §2.6)。
// 開くトリガーはホストの責務（このコンポーネントは表示中のみ mount される）。

function safeMediaSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return isSafeUrl(url) ? url : undefined
}

const props = defineProps<{
  files: NormalizedDriveFile[]
  initialIndex: number
}>()

const emit = defineEmits<{
  close: []
}>()

const index = ref(props.initialIndex)
const lightboxContentRef = ref<HTMLElement | null>(null)

const file = computed(() => props.files[index.value] ?? null)

function isImage(f: NormalizedDriveFile): boolean {
  return f.type.startsWith('image/')
}

function isVideo(f: NormalizedDriveFile): boolean {
  return f.type.startsWith('video/')
}

function close() {
  emit('close')
}

// Lightbox slide-in animation direction tracking
const slideClass = ref<string | null>(null)

watch(index, (cur, prev) => {
  slideClass.value = cur > prev ? 'nd-lb-slide-left' : 'nd-lb-slide-right'
})

function onSlideEnd() {
  slideClass.value = null
}

// ピンチズーム / パン / ダブルタップズーム (#730)
const {
  transformStyle: zoomStyle,
  zoomed,
  reset: resetZoom,
} = usePinchZoom(lightboxContentRef)

// 画像切替でズームを解除
watch(index, () => resetZoom())

useSwipeTab(
  lightboxContentRef,
  () => {
    if (index.value < props.files.length - 1) {
      index.value++
      return true
    }
    return false
  },
  () => {
    if (index.value > 0) {
      index.value--
      return true
    }
    return false
  },
  {
    cssVar: '--nd-lb-swipe',
    classes: { swiping: 'nd-lb-swiping', snapBack: 'nd-lb-snap-back' },
    wheel: true,
    checkHorizontalScroll: false,
    // ズーム中の1本指ドラッグはパンに割り当てる
    enabled: () => !zoomed.value,
  },
)

// Android 戻るボタンで閉じる (他のオーバーレイと同様 #704 F)
// useBackButton は false → true の遷移で登録されるため mount 後に立てる
const open = ref(false)
useBackButton(open, close)
onMounted(() => {
  open.value = true
})

// --- スワイプ下閉じ (ズーム中は 1 本指ドラッグがパンなので無効) ---
const dragY = ref(0)
let dragStartX = 0
let dragStartY = 0
let dragAxis: 'v' | 'h' | null = null
let dragging = false

function onTouchStart(e: TouchEvent) {
  const touch = e.touches[0]
  if (zoomed.value || e.touches.length !== 1 || !touch) return
  dragging = true
  dragAxis = null
  dragStartX = touch.clientX
  dragStartY = touch.clientY
}

function onTouchMove(e: TouchEvent) {
  const touch = e.touches[0]
  if (!dragging || zoomed.value || e.touches.length !== 1 || !touch) return
  const dx = touch.clientX - dragStartX
  const dy = touch.clientY - dragStartY
  if (dragAxis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    // 軸ロック: 横は useSwipeTab (画像切替) に任せる
    dragAxis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h'
  }
  if (dragAxis !== 'v') return
  dragY.value = Math.max(0, dy)
}

function onTouchEnd() {
  if (!dragging) return
  dragging = false
  if (dragY.value > 96) close()
  dragY.value = 0
}

const dragStyle = computed(() =>
  dragY.value > 0
    ? {
        transform: `translateY(${dragY.value}px)`,
        opacity: String(Math.max(0.3, 1 - dragY.value / 400)),
      }
    : undefined,
)

function prevImage() {
  if (index.value > 0) index.value--
}

function nextImage() {
  if (index.value < props.files.length - 1) index.value++
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prevImage()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    nextImage()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

const portalRef = useTemplateRef<HTMLElement>('portalRef')
usePortal(portalRef)

// Long-press context menu for lightbox images
const menuRef = ref<InstanceType<typeof PopupMenu>>()
const canShare = typeof navigator.share === 'function'
const { copyToClipboard } = useClipboardFeedback()

const { handlers: longPressHandlers } = useLongPress((e) => {
  menuRef.value?.open(e)
})

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  menuRef.value?.open(e)
}

async function copyImage() {
  const f = file.value
  if (!f?.url || !isSafeUrl(f.url)) return
  try {
    const res = await fetch(f.url)
    const blob = await res.blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch {
    // Fallback: copy URL as text
    await copyToClipboard(f.url)
  }
  menuRef.value?.close()
}

async function downloadImage() {
  const f = file.value
  if (!f?.url || !isSafeUrl(f.url)) return
  unwrap(await commands.saveImageToFile(f.url))
  menuRef.value?.close()
}

async function copyImageLink() {
  const f = file.value
  if (!f?.url) return
  await copyToClipboard(f.url)
  menuRef.value?.close()
}

async function shareImage() {
  const f = file.value
  if (!f?.url) return
  try {
    await navigator.share({ url: f.url })
  } catch {
    // User cancelled
  }
  menuRef.value?.close()
}

async function openInBrowser() {
  const f = file.value
  if (!f?.url) return
  await openSafeUrl(f.url)
  menuRef.value?.close()
}
</script>

<template>
  <div v-if="file" ref="portalRef" :class="$style.lightboxOverlay" @click="close">
      <button :class="$style.lightboxClose" @click="close">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>

      <!-- Prev button -->
      <button
        v-if="files.length > 1 && index > 0"
        :class="$style.lightboxNav"
        :style="{ left: '16px' }"
        @click.stop="prevImage()"
      >
        <svg viewBox="0 0 24 24" width="28" height="28">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- Next button -->
      <button
        v-if="files.length > 1 && index < files.length - 1"
        :class="$style.lightboxNav"
        :style="{ right: '16px' }"
        @click.stop="nextImage()"
      >
        <svg viewBox="0 0 24 24" width="28" height="28">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div
        ref="lightboxContentRef"
        :class="[$style.lightboxContent, slideClass]"
        :style="dragStyle"
        @animationend="onSlideEnd"
        @click.stop
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @touchend.passive="onTouchEnd"
        @touchcancel.passive="onTouchEnd"
      >
        <img
          v-if="isImage(file)"
          :src="safeMediaSrc(file.url)"
          :alt="file.name"
          :class="$style.lightboxImage"
          :style="zoomStyle"
          draggable="false"
          v-bind="longPressHandlers"
          @contextmenu="onContextMenu"
        />
        <video
          v-else-if="isVideo(file)"
          :src="safeMediaSrc(file.url)"
          :class="$style.lightboxVideo"
          controls
          autoplay
        />
      </div>

      <!-- Dot indicators -->
      <div v-if="files.length > 1" :class="$style.lightboxDots" @click.stop>
        <button
          v-for="(_, i) in files"
          :key="i"
          :class="[$style.lightboxDot, { [$style.lightboxDotActive]: i === index }]"
          @click="index = i"
        />
      </div>

      <!-- Long-press context menu -->
      <PopupMenu ref="menuRef" @click.stop>
        <button class="_popupItem" @click="copyImage">
          <i class="ti ti-copy" />
          画像をコピー
        </button>
        <button class="_popupItem" @click="downloadImage">
          <i class="ti ti-download" />
          画像をダウンロード
        </button>
        <button class="_popupItem" @click="copyImageLink">
          <i class="ti ti-link" />
          画像のリンクをコピー
        </button>
        <button v-if="canShare" class="_popupItem" @click="shareImage">
          <i class="ti ti-share" />
          画像を共有
        </button>
        <button class="_popupItem" @click="openInBrowser">
          <i class="ti ti-external-link" />
          ブラウザで開く
        </button>
      </PopupMenu>
  </div>
</template>

<style lang="scss" module>
.lightboxContent {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  /* スワイプ / ピンチズーム / パンは JS で処理する */
  touch-action: none;
}

.lightboxOverlay {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nd-overlayLightbox);
  cursor: pointer;
}

.lightboxClose {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
  transition: background var(--nd-duration-base);
  z-index: 1;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.lightboxImage {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  /* Allow native long-press context menu on mobile WebView */
  -webkit-touch-callout: default;
  -webkit-user-select: auto;
  user-select: auto;
  touch-action: none;
}

.lightboxVideo {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 4px;
}

.lightboxNav {
  position: absolute;
  top: 50%;
  translate: 0 -50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
  z-index: 1;
  transition: background var(--nd-duration-base);

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.lightboxDots {
  position: absolute;
  bottom: 20px;
  left: 50%;
  translate: -50% 0;
  display: flex;
  gap: 8px;
  z-index: 1;
}

.lightboxDot {
  width: 8px;
  height: 8px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 0;
  transition: background var(--nd-duration-base);

  &:hover {
    background: rgba(255, 255, 255, 0.7);
  }
}

.lightboxDotActive {
  background: #fff;
}

/* Lightbox swipe & slide animation (global classes — not CSS Modules) */
:global(.nd-lb-swiping) {
  translate: var(--nd-lb-swipe, 0) 0;
}

:global(.nd-lb-snap-back) {
  transition: translate 0.25s var(--nd-ease-spring);
  translate: var(--nd-lb-swipe, 0) 0;
}

@keyframes nd-lb-slide-left-kf {
  from { opacity: 0; translate: calc(40% + 12px) 0; }
  to   { opacity: 1; translate: none; }
}

@keyframes nd-lb-slide-right-kf {
  from { opacity: 0; translate: calc(-40% - 12px) 0; }
  to   { opacity: 1; translate: none; }
}

:global(.nd-lb-slide-left) {
  animation: nd-lb-slide-left-kf 0.2s var(--nd-ease-spring) both;
}

:global(.nd-lb-slide-right) {
  animation: nd-lb-slide-right-kf 0.2s var(--nd-ease-spring) both;
}
</style>
