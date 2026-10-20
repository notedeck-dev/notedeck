<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

/**
 * $[sparkle] の粒子エフェクト。本家 MkSparkle.vue の移植。
 * 子要素の周りに星型の粒子をランダムに生成し、回転しながら拡大縮小して消える。
 * SVG の animateTransform は Chrome で描画できないので CSS アニメーションを使う
 * (本家 issue 14155)。
 */

interface Particle {
  id: number
  x: number
  y: number
  size: number
  dur: number
  color: string
}

const STAR_PATH =
  'M29.427,2.011C29.721,0.83 30.782,0 32,0C33.218,0 34.279,0.83 34.573,2.011L39.455,21.646C39.629,22.347 39.991,22.987 40.502,23.498C41.013,24.009 41.653,24.371 42.354,24.545L61.989,29.427C63.17,29.721 64,30.782 64,32C64,33.218 63.17,34.279 61.989,34.573L42.354,39.455C41.653,39.629 41.013,39.991 40.502,40.502C39.991,41.013 39.629,41.653 39.455,42.354L34.573,61.989C34.279,63.17 33.218,64 32,64C30.782,64 29.721,63.17 29.427,61.989L24.545,42.354C24.371,41.653 24.009,41.013 23.498,40.502C22.987,39.991 22.347,39.629 21.646,39.455L2.011,34.573C0.83,34.279 0,33.218 0,32C0,30.782 0.83,29.721 2.011,29.427L21.646,24.545C22.347,24.371 22.987,24.009 23.498,23.498C24.009,22.987 24.371,22.347 24.545,21.646L29.427,2.011Z'
const COLORS = ['#FF1493', '#00FFFF', '#FFE202', '#FFE202', '#FFE202']

const particles = ref<Particle[]>([])
const el = useTemplateRef<HTMLElement>('el')
const width = ref(0)
const height = ref(0)
let nextId = 0
let stopped = false
let ro: ResizeObserver | undefined
const timers = new Set<ReturnType<typeof setTimeout>>()

function later(fn: () => void, ms: number) {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}

/** 画面外の行 (MkNote の .offscreen が --nd-mfm-play-state: paused を配る) では粒子を足さない */
function isPaused(): boolean {
  if (!el.value) return true
  return (
    getComputedStyle(el.value)
      .getPropertyValue('--nd-mfm-play-state')
      .trim() === 'paused'
  )
}

function add() {
  if (stopped) return
  if (!isPaused()) {
    const sizeFactor = Math.random()
    const particle: Particle = {
      id: nextId++,
      x: Math.random() * (width.value - 64),
      y: Math.random() * (height.value - 64),
      size: 0.2 + (sizeFactor / 10) * 3,
      dur: 1000 + sizeFactor * 1000,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] as string,
    }
    particles.value.push(particle)
    later(() => {
      particles.value = particles.value.filter((p) => p.id !== particle.id)
    }, particle.dur - 100)
  }
  later(add, 500 + Math.random() * 500)
}

onMounted(() => {
  if (!el.value) return
  ro = new ResizeObserver(() => {
    if (!el.value) return
    width.value = el.value.offsetWidth + 64
    height.value = el.value.offsetHeight + 64
  })
  ro.observe(el.value)
  add()
})

onBeforeUnmount(() => {
  stopped = true
  ro?.disconnect()
  for (const t of timers) clearTimeout(t)
  timers.clear()
})
</script>

<template>
  <span :class="$style.root"><span ref="el" :class="$style.content"><slot /></span><svg v-for="particle in particles" :key="particle.id" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" xmlns="http://www.w3.org/2000/svg" :class="$style.layer"><path :class="$style.particle" :style="{ '--translateX': `${particle.x}px`, '--translateY': `${particle.y}px`, '--duration': `${particle.dur}ms`, '--size': particle.size }" :fill="particle.color" :d="STAR_PATH" /></svg></span>
</template>

<style lang="scss" module>
.root {
  position: relative;
  display: inline-block;
}

.content {
  display: inline-block;
}

/* MFM の上のレイヤーに出るので、下のリンクを押せるように pointer-events を切る */
.layer {
  position: absolute;
  top: -32px;
  left: -32px;
  pointer-events: none;
}

.particle {
  transform-origin: center;
  transform-box: fill-box;
  translate: var(--translateX) var(--translateY);
  animation: mfm-sparkle-particle var(--duration) linear infinite;
  animation-play-state: var(--nd-mfm-play-state, running);
}

@keyframes mfm-sparkle-particle {
  0% {
    rotate: 0deg;
    scale: 0;
  }
  50% {
    scale: var(--size);
  }
  100% {
    rotate: 360deg;
    scale: 0;
  }
}
</style>
