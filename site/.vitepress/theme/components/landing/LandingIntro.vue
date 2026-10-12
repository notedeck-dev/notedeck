<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()

/** README が載せている最新スクショ。ここに書いてある URL で先に塗る。 */
const DEFAULT_SCREENSHOT =
  'https://github.com/user-attachments/assets/610f1403-471b-4298-abd9-a1f92cc5942d'

const shots = ref([DEFAULT_SCREENSHOT])

onMounted(async () => {
  // README が別のスクショに差し替わっていたときだけ追従する
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/notedeck-dev/notedeck/main/README.md',
    )
    const md = await res.text()
    const found = [
      ...md.matchAll(/<img[^>]+src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/g),
    ].map((m) => m[1])
    if (found.length > 0) shots.value = found
  } catch {
    /* 取れなければ既定のスクショのまま */
  }
})

const track = ref<HTMLElement | null>(null)
function scrollBy(direction: 1 | -1) {
  const el = track.value
  if (!el) return
  const slide = el.querySelector<HTMLElement>('.intro-slide')
  el.scrollBy({ left: (slide?.offsetWidth ?? el.clientWidth) * direction, behavior: 'smooth' })
}
</script>

<template>
  <!-- Hub .section_introduction: #f7f7f7 の面にパララックスする抽象画 + 本文 + スクショのスライダー -->
  <section id="introduction" class="intro w-primary">
    <div data-fade>
      <div class="intro-bg">
        <img class="intro-bg-image" src="/icon-512.png" alt="" aria-hidden="true" />
      </div>
    </div>
    <div data-fade="right">
      <div class="intro-content w-secondary">
        <h2 class="intro-title"><b class="u-line">{{ t.intro.title }}</b></h2>
        <p class="intro-desc" v-html="t.intro.descHtml" />
      </div>
    </div>
    <div data-fade>
      <div class="intro-gallery acrylic w-secondary">
        <div ref="track" class="intro-track">
          <figure v-for="(src, i) in shots" :key="src" class="intro-slide">
            <img
              :src="src"
              :alt="t.hero.screenshotAlt"
              width="2376"
              height="1706"
              :loading="i === 0 ? 'eager' : 'lazy'"
              decoding="async"
            />
          </figure>
        </div>
        <template v-if="shots.length > 1">
          <button type="button" class="intro-nav intro-nav-prev" aria-label="prev" @click="scrollBy(-1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button type="button" class="intro-nav intro-nav-next" aria-label="next" @click="scrollBy(1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </template>
      </div>
    </div>
  </section>

  <!-- Hub .introductionTip -->
  <section class="intro-tip w-secondary">
    <p><b class="chip">TIP:</b><span>{{ t.intro.tip }}</span></p>
  </section>
</template>
