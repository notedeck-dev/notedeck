<script setup lang="ts">
/**
 * MkRippleEffect — Misskey-style SVG particle burst effect.
 *
 * Shows a ring expanding outward with 12 colorful particles scattering
 * in random directions. Used when adding a reaction to give satisfying
 * visual feedback ("celebration" feel).
 *
 * Adapted from Misskey's MkRippleEffect.vue.
 */
import { onMounted, ref } from 'vue'

const props = defineProps<{
  x: number
  y: number
}>()

const emit = defineEmits<{
  done: []
}>()

const PARTICLE_COUNT = 12
const PARTICLE_COLORS = ['#FF1493', '#00FFFF', '#FFE202'] as const
const RING_DURATION = 500
const PARTICLE_DURATION = 800
const TOTAL_LIFETIME = 1100

interface Particle {
  x: number
  y: number
  size: number
  color: string
  dx: number
  dy: number
}

const particles = ref<Particle[]>([])
const ringR = ref(4)
const ringStroke = ref(16)
const ringOpacity = ref(1)
const particleOpacity = ref(1)

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches

onMounted(() => {
  if (prefersReducedMotion) {
    emit('done')
    return
  }

  // Generate particles
  const ps: Particle[] = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + rand(-0.3, 0.3)
    const speed = rand(16, 64)
    ps.push({
      x: 0,
      y: 0,
      size: rand(4, 12),
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length] ?? '#FF1493',
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
    })
  }
  particles.value = ps

  // Animate ring
  const ringStart = performance.now()
  const particleStart = ringStart

  function tick(now: number) {
    const ringElapsed = now - ringStart
    const particleElapsed = now - particleStart

    // Ring: radius 4→32, stroke 16→0
    if (ringElapsed < RING_DURATION) {
      const t = ringElapsed / RING_DURATION
      // easeOutQuart
      const ease = 1 - (1 - t) ** 4
      ringR.value = 4 + 28 * ease
      ringStroke.value = 16 * (1 - t)
      ringOpacity.value = 1 - t * 0.5
    } else {
      ringOpacity.value = 0
    }

    // Particles: scatter outward
    if (particleElapsed < PARTICLE_DURATION) {
      const t = particleElapsed / PARTICLE_DURATION
      // easeOutCubic
      const ease = 1 - (1 - t) ** 3
      const newPs = ps.map((p) => ({
        ...p,
        x: p.dx * ease,
        y: p.dy * ease,
      }))
      particles.value = newPs
      particleOpacity.value = 1 - t
    } else {
      particleOpacity.value = 0
    }

    if (now - ringStart < TOTAL_LIFETIME) {
      requestAnimationFrame(tick)
    } else {
      emit('done')
    }
  }

  requestAnimationFrame(tick)
})
</script>

<template>
  <svg
    :class="$style.root"
    :style="{ left: `${props.x}px`, top: `${props.y}px` }"
    width="128"
    height="128"
    viewBox="-64 -64 128 128"
  >
    <!-- Expanding ring -->
    <circle
      cx="0"
      cy="0"
      :r="ringR"
      fill="none"
      stroke="currentColor"
      :stroke-width="ringStroke"
      :opacity="ringOpacity"
    />
    <!-- Particles -->
    <circle
      v-for="(p, i) in particles"
      :key="i"
      :cx="p.x"
      :cy="p.y"
      :r="p.size / 2"
      :fill="p.color"
      :opacity="particleOpacity"
    />
  </svg>
</template>

<style lang="scss" module>
.root {
  position: fixed;
  z-index: calc(var(--nd-z-popup) + 10);
  pointer-events: none;
  color: var(--nd-accentText);
  transform: translate(-50%, -50%);
  overflow: visible;
}
</style>
