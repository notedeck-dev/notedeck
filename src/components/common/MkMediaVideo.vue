<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import { useMediaPlayer } from '@/composables/useMediaPlayer'
import { i18n } from '@/i18n'
import { formatMediaTime } from '@/services/mediaTime'
import { isSafeUrl } from '@/services/safeUrl'
import { proxyUrl } from '@/utils/mediaProxy'
import LoadingSpinner from './LoadingSpinner.vue'
import MkMediaPlayerMenu from './MkMediaPlayerMenu.vue'
import MkMediaRange from './MkMediaRange.vue'

// 添付動画の独自プレイヤー (#1214)。本家 MkMediaVideo に合わせ、WebView 標準の
// controls を出さずにテーマに沿ったコントロールを重ねる。
//
// 動画本体は元の URL を直接読む (画像プロキシに載せない理由は mediaProxy.ts の
// 冒頭の注記)。サムネイルがあるときはそれをプロキシ経由の
// ポスターにして本体は読まない (preload="none")。タイムラインに動画が並んでも、
// 再生するまで相手サーバーへ接続しない
const props = defineProps<{
  file: NormalizedDriveFile
  /** ライトボックス: 開いたらすぐ再生する */
  autoplay?: boolean
}>()

const emit = defineEmits<{
  /** ポスターか最初のフレームが出た (グリッドのシマーを外す合図) */
  loaded: []
  error: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)
const menuRef = ref<InstanceType<typeof MkMediaPlayerMenu>>()

const player = useMediaPlayer(videoRef)
const { playing, started, waiting, loop, rate } = player

const src = computed(() =>
  isSafeUrl(props.file.url) ? props.file.url : undefined,
)
const posterFailed = ref(false)
const posterSrc = computed(() => {
  const thumb = props.file.thumbnailUrl
  if (posterFailed.value || !thumb || !isSafeUrl(thumb)) return undefined
  return proxyUrl(thumb)
})
// ポスターが無いときは最初のフレームを出すためにメタデータだけ読む (従来どおり)
const preload = computed(() =>
  props.autoplay ? 'auto' : posterSrc.value ? 'none' : 'metadata',
)

// --- コントロールの表示 (本家と同じく操作が止まって 3 秒で隠す) ---
const active = ref(false)
const menuOpen = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
let lastPointerType = 'mouse'
let visibleAtPointerDown = true

const controlsVisible = computed(
  () => !started.value || !playing.value || active.value || menuOpen.value,
)

function bumpActivity() {
  active.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    active.value = false
  }, 3000)
}

function onPointerDown(e: PointerEvent) {
  lastPointerType = e.pointerType
  visibleAtPointerDown = controlsVisible.value
  bumpActivity()
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerType === 'mouse') bumpActivity()
}

function onPointerLeave(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  if (hideTimer) clearTimeout(hideTimer)
  active.value = false
}

// 画面のタップ: 隠れていたコントロールを出すだけにする (タップで止まると、
// コントロールを出したいだけの操作で毎回一時停止してしまう)。マウスは本家と同じく再生 / 一時停止
function onSurfaceClick() {
  if (lastPointerType !== 'mouse' && !visibleAtPointerDown) return
  player.togglePlay()
}

// --- 全画面 / ピクチャーインピクチャー ---
const isFullscreen = ref(false)

function onFullscreenChange() {
  isFullscreen.value =
    !!rootRef.value && document.fullscreenElement === rootRef.value
}

function toggleFullscreen() {
  const root = rootRef.value
  const video = videoRef.value
  if (!root || !video) return
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined)
    return
  }
  if (typeof root.requestFullscreen === 'function') {
    // コントロールごと全画面にする (video 単体だと標準の controls に戻る)
    root.requestFullscreen().catch(() => undefined)
    return
  }
  // iOS は要素の全画面を持たない。video 単体の全画面 (標準のプレイヤー) に倒す
  ;(
    video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
  ).webkitEnterFullscreen?.()
}

const pipAvailable =
  typeof document !== 'undefined' && document.pictureInPictureEnabled === true

function togglePip() {
  const video = videoRef.value
  if (!video) return
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => undefined)
  } else {
    video.requestPictureInPicture().catch(() => undefined)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (player.onKeydown(e)) {
    bumpActivity()
    return
  }
  if (e.key === 'f' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault()
    e.stopPropagation()
    toggleFullscreen()
  }
}

function openMenu(e: MouseEvent) {
  menuRef.value?.open(e)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <div
    ref="rootRef"
    :class="[$style.root, controlsVisible && $style.active, !controlsVisible && $style.idle]"
    tabindex="0"
    @click.stop
    @dblclick.stop
    @contextmenu.stop
    @keydown="onKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <video
      ref="videoRef"
      :class="$style.video"
      :src="src"
      :preload="preload"
      :autoplay="autoplay"
      :title="file.comment ?? undefined"
      playsinline
      v-on="player.events"
      @loadeddata="emit('loaded')"
      @error="emit('error')"
      @click="onSurfaceClick"
    />
    <img
      v-if="posterSrc && !started"
      :src="posterSrc"
      :class="$style.poster"
      alt=""
      aria-hidden="true"
      draggable="false"
      @load="emit('loaded')"
      @error="posterFailed = true"
      @click="onSurfaceClick"
    />

    <div v-if="playing && waiting" :class="$style.center">
      <LoadingSpinner />
    </div>
    <button
      v-else-if="!playing"
      type="button"
      class="_button"
      :class="[$style.center, $style.bigPlay]"
      :aria-label="i18n.ts._mkMediaPlayer.play"
      @click="player.togglePlay()"
    >
      <i class="ti ti-player-play" />
    </button>

    <!-- シークバーのドラッグがライトボックスのスワイプ (画像送り / 下で閉じる) にならないよう止める -->
    <div
      :class="$style.controls"
      @touchstart.stop
      @touchmove.stop
      @touchend.stop
    >
      <div :class="$style.left">
        <button
          type="button"
          class="_button"
          :class="$style.button"
          :aria-label="playing ? i18n.ts._mkMediaPlayer.pause : i18n.ts._mkMediaPlayer.play"
          @click="player.togglePlay()"
        >
          <i :class="playing ? 'ti ti-player-pause' : 'ti ti-player-play'" />
        </button>
      </div>
      <div :class="$style.time">
        {{ formatMediaTime(player.currentTime.value) }}<template v-if="Number.isFinite(player.duration.value)"> / {{ formatMediaTime(player.duration.value) }}</template>
      </div>
      <div :class="$style.volume">
        <button
          type="button"
          class="_button"
          :class="$style.button"
          :aria-label="player.effectiveVolume.value === 0 ? i18n.ts._mkMediaPlayer.unmute : i18n.ts._mkMediaPlayer.mute"
          @click="player.toggleMute()"
        >
          <i :class="player.effectiveVolume.value === 0 ? 'ti ti-volume-3' : 'ti ti-volume'" />
        </button>
        <MkMediaRange
          :class="$style.volumeRange"
          :model-value="player.effectiveVolume.value"
          :label="i18n.ts._mkMediaPlayer.volume"
          overlay
          @update:model-value="player.setVolume"
        />
      </div>
      <div :class="$style.right">
        <button
          type="button"
          class="_button"
          :class="$style.button"
          :aria-label="i18n.ts._mkMediaPlayer.settings"
          @click="openMenu"
        >
          <i class="ti ti-settings" />
        </button>
        <button
          type="button"
          class="_button"
          :class="$style.button"
          :aria-label="isFullscreen ? i18n.ts._mkMediaPlayer.exitFullscreen : i18n.ts._mkMediaPlayer.fullscreen"
          @click="toggleFullscreen"
        >
          <i :class="isFullscreen ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize'" />
        </button>
      </div>
      <MkMediaRange
        :class="$style.seek"
        :model-value="player.progress.value"
        :buffer="player.buffered.value"
        :label="i18n.ts._mkMediaPlayer.seek"
        overlay
        @update:model-value="player.seekTo"
      />
    </div>

    <MkMediaPlayerMenu
      ref="menuRef"
      :loop="loop"
      :rate="rate"
      :pip="pipAvailable"
      @toggle-loop="player.toggleLoop()"
      @set-rate="player.setRate"
      @pip="togglePip"
      @open-change="menuOpen = $event"
    />
  </div>
</template>

<style lang="scss" module>
.root {
  container-type: inline-size;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #fff;

  &:focus-visible {
    outline: none;
  }

  &:fullscreen {
    background: #000;
  }
}

.idle {
  cursor: none;
}

.video,
.poster {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.poster {
  position: absolute;
  inset: 0;
}

.center {
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  display: grid;
  place-items: center;
}

/* _button の display (0,1,0) に負けないよう (0,2,0) にする */
.root .bigPlay {
  display: grid;
  width: 52px;
  height: 52px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: #fff;
  font-size: var(--nd-font-xl);
  opacity: 0;
  transition: opacity var(--nd-duration-base), transform var(--nd-duration-fast) var(--nd-ease-spring);

  &:active {
    transform: scale(var(--nd-active-scale));
  }
}

.controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-areas:
    'left time . volume right'
    'seek seek seek seek seek';
  grid-template-columns: auto auto 1fr auto auto;
  align-items: center;
  gap: 2px 8px;
  padding: 32px 10px 8px;
  background: linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.75));
  opacity: 0;
  transform: translateY(100%);
  pointer-events: none;
  transition: opacity var(--nd-duration-slow) var(--nd-ease-decel), transform var(--nd-duration-slow) var(--nd-ease-decel);
}

.active,
.root:has(:focus-visible) {
  .controls {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }

  .bigPlay {
    opacity: 1;
  }
}

.left,
.right,
.volume {
  display: flex;
  align-items: center;
  gap: 2px;
}

.left {
  grid-area: left;
}

.right {
  grid-area: right;
}

.volume {
  grid-area: volume;
}

.time {
  grid-area: time;
  font-size: var(--nd-font-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.seek {
  grid-area: seek;
}

.controls .button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--nd-radius-sm);
  color: #fff;
  font-size: var(--nd-font-lg);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: -2px;
  }
}

/* 音量スライダーは幅に余裕があるときだけ (本家と同じ) */
.volumeRange {
  display: none;
}

@container (min-width: 500px) {
  .controls {
    grid-template-areas: 'left seek time volume right';
    grid-template-columns: auto 1fr auto auto auto;
  }

  .volumeRange {
    display: flex;
    width: 80px;
  }
}
</style>
