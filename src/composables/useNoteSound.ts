import { usePerformanceStore } from '@/stores/performance'
import { proxyUrl } from '@/utils/mediaProxy'

const RETRY_AFTER_MS = 5 * 60 * 1000
const IS_ANDROID = /Android/i.test(navigator.userAgent)
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// --- Web Audio API (desktop / iOS) ---

function getSoundCacheMax(): number {
  try {
    return usePerformanceStore().get('soundCacheMax')
  } catch {
    return 8
  }
}
const bufferCache = new Map<string, AudioBuffer>()
const failedHosts = new Map<string, number>()
let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

// Mobile browsers require user interaction to activate AudioContext
if (IS_MOBILE && !IS_ANDROID) {
  const activate = () => {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
  }
  document.addEventListener('touchstart', activate, { once: true })
  document.addEventListener('click', activate, { once: true })
}

function getSoundUrl(host: string, soundType: string): string {
  const remoteUrl = `https://${host}/client-assets/sounds/${soundType}.mp3`
  // 画像と同じプロキシ (ループバック HTTP) に寄せる。常にブロッキングで
  // 本物が返るので fetch/Audio 要素でもそのまま使える
  return proxyUrl(remoteUrl) ?? remoteUrl
}

async function ensureBuffer(
  host: string,
  soundType: string,
): Promise<AudioBuffer | null> {
  const cacheKey = `${host}:${soundType}`
  const cached = bufferCache.get(cacheKey)
  if (cached) return cached

  const failedAt = failedHosts.get(cacheKey)
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return null

  try {
    const url = getSoundUrl(host, soundType)
    const resp = await fetch(url)
    if (!resp.ok) {
      failedHosts.set(cacheKey, Date.now())
      return null
    }
    const arrayBuf = await resp.arrayBuffer()
    const ctx = getAudioContext()
    const audioBuf = await ctx.decodeAudioData(arrayBuf)
    if (bufferCache.size >= getSoundCacheMax()) {
      const oldest = bufferCache.keys().next().value
      if (oldest !== undefined) bufferCache.delete(oldest)
    }
    bufferCache.set(cacheKey, audioBuf)
    failedHosts.delete(cacheKey)
    return audioBuf
  } catch {
    failedHosts.set(cacheKey, Date.now())
    return null
  }
}

// --- HTMLAudioElement (Android) ---
// Android WebView の AudioContext は decodeAudioData / resume が
// 不安定なため、HTMLAudioElement で OS のメディアプレイヤーに委譲する。

const audioElCache = new Map<string, HTMLAudioElement>()

function ensureAudioElement(host: string, soundType: string): HTMLAudioElement {
  const cacheKey = `${host}:${soundType}`
  const cached = audioElCache.get(cacheKey)
  if (cached) return cached

  const el = new Audio(getSoundUrl(host, soundType))
  el.volume = 0.3
  el.preload = 'auto'
  if (audioElCache.size >= getSoundCacheMax()) {
    const oldest = audioElCache.keys().next().value
    if (oldest !== undefined) audioElCache.delete(oldest)
  }
  audioElCache.set(cacheKey, el)
  return el
}

// --- Public API ---

export function useNoteSound(
  getHost: () => string | undefined,
  soundType = 'syuilo/n-aec',
) {
  let lastPlayedAt = 0

  async function play() {
    const now = Date.now()
    if (now - lastPlayedAt < 300) return
    lastPlayedAt = now

    const host = getHost()
    if (!host) return

    if (IS_ANDROID) {
      const el = ensureAudioElement(host, soundType)
      el.currentTime = 0
      el.play().catch(() => {
        // Autoplay blocked by browser policy — expected on mobile
      })
      return
    }

    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()

    const buffer = await ensureBuffer(host, soundType)
    if (!buffer) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    // Fade-in to prevent crackling/popping
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.005)
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
  }

  function warmup() {
    const host = getHost()
    if (!host) return
    if (IS_ANDROID) {
      ensureAudioElement(host, soundType)
    } else {
      ensureBuffer(host, soundType)
    }
  }

  return { play, warmup }
}
