<script setup lang="ts">
import HeroBlobs from './HeroBlobs.vue'

/**
 * Hub .section_features の枠。上端に面カード (ブロブ入り) を敷き、
 * 脇に大きな英字ラベルを sticky で置き、中央見出しの下に中身 (slot) を流す。
 */
defineProps<{
  id?: string
  /** 脇に出す英字 (Hub: FEATURES / BACKEND / FRONTEND) */
  label: string
  side: 'left' | 'right'
  title: string
  desc?: string
}>()
</script>

<template>
  <section :id="id" class="frame w-primary">
    <div data-fade>
      <div class="frame-bg">
        <HeroBlobs />
      </div>
    </div>
    <div class="frame-side" :class="`frame-side-${side}`" aria-hidden="true">
      <div class="frame-side-sticky">
        <div data-fade>
          <div class="frame-label">{{ label }}</div>
        </div>
      </div>
    </div>
    <div data-fade>
      <div class="frame-head w-secondary">
        <h2 class="frame-title"><b class="u-line">{{ title }}</b></h2>
        <p v-if="desc" class="frame-desc">{{ desc }}</p>
      </div>
    </div>
    <div data-fade>
      <div class="frame-body w-secondary">
        <slot />
      </div>
    </div>
  </section>
</template>
