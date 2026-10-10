<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import { useMediaPlayer } from '@/composables/useMediaPlayer'
import { i18n } from '@/i18n'
import { formatMediaTime } from '@/services/mediaTime'
import { isSafeUrl } from '@/services/safeUrl'
import { proxyMediaUrl } from '@/utils/mediaProxy'
import MkMediaPlayerMenu from './MkMediaPlayerMenu.vue'
import MkMediaRange from './MkMediaRange.vue'

// 添付音声の独自プレイヤー (#1214)。本家 MkMediaAudio と同じ並び
// (再生 / 時間 / 音量 / 設定 + シークバー)。本体は動画と同じ中継
// (`/proxy/media`、Range をそのまま転送してキャッシュしない) から読み、
// 読めなかったときだけ元の URL に戻す (理由は mediaProxy.ts の冒頭の注記)
const props = defineProps<{
  file: NormalizedDriveFile
}>()

const audioRef = ref<HTMLAudioElement | null>(null)
const menuRef = ref<InstanceType<typeof MkMediaPlayerMenu>>()

const player = useMediaPlayer(audioRef)
const { playing, loop, rate } = player

const streamFailed = ref(false)
const src = computed(() => {
  if (!isSafeUrl(props.file.url)) return undefined
  return streamFailed.value ? props.file.url : proxyMediaUrl(props.file.url)
})

watch(
  () => props.file.url,
  () => {
    streamFailed.value = false
  },
)

// 中継で読めなかったものは元の URL で 1 度だけ読み直す
function onAudioError() {
  if (src.value !== props.file.url) streamFailed.value = true
}
</script>

<template>
  <div
    :class="$style.root"
    tabindex="0"
    @click.stop
    @keydown="player.onKeydown"
  >
    <audio
      ref="audioRef"
      :src="src"
      preload="metadata"
      v-on="player.events"
      @error="onAudioError"
    />
    <div :class="$style.bar">
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
          @update:model-value="player.setVolume"
        />
      </div>
      <div :class="$style.right">
        <button
          type="button"
          class="_button"
          :class="$style.button"
          :aria-label="i18n.ts._mkMediaPlayer.settings"
          @click="menuRef?.open($event)"
        >
          <i class="ti ti-settings" />
        </button>
      </div>
      <MkMediaRange
        :class="$style.seek"
        :model-value="player.progress.value"
        :buffer="player.buffered.value"
        :label="i18n.ts._mkMediaPlayer.seek"
        @update:model-value="player.seekTo"
      />
      <div :class="$style.name">{{ file.name }}</div>
    </div>

    <MkMediaPlayerMenu
      ref="menuRef"
      :loop="loop"
      :rate="rate"
      @toggle-loop="player.toggleLoop()"
      @set-rate="player.setRate"
    />
  </div>
</template>

<style lang="scss" module>
.root {
  container-type: inline-size;

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: -2px;
  }
}

/* @container は自分自身には効かないので、グリッドは内側の要素に持たせる */
.bar {
  display: grid;
  grid-template-areas:
    'left time . volume right'
    'seek seek seek seek seek'
    'name name name name name';
  grid-template-columns: auto auto 1fr auto auto;
  align-items: center;
  gap: 2px 8px;
  padding: 6px 10px;
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

.name {
  grid-area: name;
  font-size: var(--nd-font-xs);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* _button の display (0,1,0) に負けないよう (0,2,0) にする */
.root .button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--nd-radius-sm);
  font-size: var(--nd-font-lg);
  transition: background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    color: var(--nd-accent);
    background: var(--nd-accentedBg);
  }
}

.volumeRange {
  display: none;
}

@container (min-width: 500px) {
  .bar {
    grid-template-areas:
      'left seek time volume right'
      'name name name name name';
    grid-template-columns: auto 1fr auto auto auto;
  }

  .volumeRange {
    display: flex;
    width: 80px;
  }
}
</style>
