import { computed, type Ref, ref } from 'vue'

/**
 * 動画・音声プレイヤーの状態と操作 (#1214)。
 *
 * 状態はメディア要素のイベントから写すだけで、要素が正本。`<video>` /
 * `<audio>` に `v-on="events"` で付ける。本家 MkMediaVideo は rAF で毎フレーム
 * currentTime を読むが、ノートに並ぶ全プレイヤーが毎フレーム回るのを避けて
 * timeupdate (数 Hz) で足りる分だけ写す。
 */

/** 直前に選んだ音量。次に開くプレイヤーも同じ音量で始める (保存はしない) */
let lastVolume = 1

const SEEK_STEP = 5
const VOLUME_STEP = 0.1

export function useMediaPlayer(media: Ref<HTMLMediaElement | null>) {
  const playing = ref(false)
  const started = ref(false)
  const waiting = ref(false)
  const currentTime = ref(0)
  const duration = ref(Number.NaN)
  const bufferedEnd = ref(0)
  const volume = ref(lastVolume)
  const muted = ref(false)
  const rate = ref(1)
  const loop = ref(false)

  const progress = computed(() =>
    Number.isFinite(duration.value) && duration.value > 0
      ? currentTime.value / duration.value
      : 0,
  )
  const buffered = computed(() =>
    Number.isFinite(duration.value) && duration.value > 0
      ? bufferedEnd.value / duration.value
      : 0,
  )
  /** スライダーに出す音量 (ミュート中は 0) */
  const effectiveVolume = computed(() => (muted.value ? 0 : volume.value))

  function readBuffered(el: HTMLMediaElement) {
    const ranges = el.buffered
    const t = el.currentTime
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= t && t <= ranges.end(i)) {
        bufferedEnd.value = ranges.end(i)
        return
      }
    }
    bufferedEnd.value = 0
  }

  function sync(el: HTMLMediaElement) {
    currentTime.value = el.currentTime
    duration.value = el.duration
  }

  const events = {
    loadedmetadata: (e: Event) => {
      const el = e.target as HTMLMediaElement
      el.volume = volume.value
      el.muted = muted.value
      el.playbackRate = rate.value
      el.loop = loop.value
      sync(el)
    },
    durationchange: (e: Event) => sync(e.target as HTMLMediaElement),
    timeupdate: (e: Event) => sync(e.target as HTMLMediaElement),
    progress: (e: Event) => readBuffered(e.target as HTMLMediaElement),
    play: () => {
      playing.value = true
      started.value = true
    },
    pause: () => {
      playing.value = false
    },
    ended: () => {
      playing.value = false
      waiting.value = false
    },
    waiting: () => {
      waiting.value = true
    },
    playing: () => {
      waiting.value = false
    },
    canplay: () => {
      waiting.value = false
    },
    volumechange: (e: Event) => {
      const el = e.target as HTMLMediaElement
      volume.value = el.volume
      muted.value = el.muted
    },
    ratechange: (e: Event) => {
      rate.value = (e.target as HTMLMediaElement).playbackRate
    },
  }

  function play() {
    const el = media.value
    if (!el) return
    // 自動再生の制限や取り消しで reject される。状態はイベントが写す
    el.play()?.catch(() => undefined)
  }

  function togglePlay() {
    const el = media.value
    if (!el) return
    if (el.paused || el.ended) play()
    else el.pause()
  }

  function seekTo(ratio: number) {
    const el = media.value
    if (!el || !Number.isFinite(el.duration)) return
    el.currentTime = ratio * el.duration
    currentTime.value = el.currentTime
  }

  function seekBy(delta: number) {
    const el = media.value
    if (!el) return
    const end = Number.isFinite(el.duration) ? el.duration : Infinity
    el.currentTime = Math.min(end, Math.max(0, el.currentTime + delta))
    currentTime.value = el.currentTime
  }

  function setVolume(v: number) {
    const next = Math.min(1, Math.max(0, v))
    volume.value = next
    muted.value = next === 0
    if (next > 0) lastVolume = next
    const el = media.value
    if (el) {
      el.volume = next
      el.muted = muted.value
    }
  }

  function toggleMute() {
    if (muted.value || volume.value === 0) {
      setVolume(volume.value > 0 ? volume.value : lastVolume)
    } else {
      muted.value = true
      if (media.value) media.value.muted = true
    }
  }

  function setRate(r: number) {
    rate.value = r
    if (media.value) media.value.playbackRate = r
  }

  function toggleLoop() {
    loop.value = !loop.value
    if (media.value) media.value.loop = loop.value
  }

  /**
   * プレイヤーにフォーカスがあるときのキー操作 (本家と同じ割り当て)。
   * 扱ったキーだけ伝播を止める。ライトボックスの ← / → (前後の画像) や
   * Escape (閉じる) は document で聞いているので、扱わないキーは通す
   */
  function onKeydown(e: KeyboardEvent): boolean {
    // スライダー上の矢印はスライダー自身が値を動かす
    if (e.target instanceof HTMLInputElement) return false
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    switch (e.key) {
      case ' ':
      case 'k':
        togglePlay()
        break
      case 'ArrowLeft':
        seekBy(-SEEK_STEP)
        break
      case 'ArrowRight':
        seekBy(SEEK_STEP)
        break
      case 'ArrowUp':
        setVolume(effectiveVolume.value + VOLUME_STEP)
        break
      case 'ArrowDown':
        setVolume(effectiveVolume.value - VOLUME_STEP)
        break
      case 'm':
        toggleMute()
        break
      default:
        return false
    }
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  return {
    playing,
    started,
    waiting,
    currentTime,
    duration,
    progress,
    buffered,
    volume,
    muted,
    effectiveVolume,
    rate,
    loop,
    events,
    play,
    togglePlay,
    seekTo,
    seekBy,
    setVolume,
    toggleMute,
    setRate,
    toggleLoop,
    onKeydown,
  }
}
