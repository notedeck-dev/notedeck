<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()

type Shot = { src: string; width: number; height: number; alt: string }

/** README が載せている最新のデスクトップ版スクショ。ここに書いてある URL で先に塗る。 */
const DESKTOP_SCREENSHOT =
  'https://github.com/user-attachments/assets/610f1403-471b-4298-abd9-a1f92cc5942d'
/** スマホ版は #1154 のコメントに貼ったもの */
const MOBILE_SCREENSHOT =
  'https://github.com/user-attachments/assets/3019c26d-414e-406e-836d-8fada5fc14a9'

const shots = ref<Shot[]>([
  { src: DESKTOP_SCREENSHOT, width: 2376, height: 1706, alt: t.value.hero.screenshotAlt },
  { src: MOBILE_SCREENSHOT, width: 836, height: 1500, alt: t.value.hero.screenshotMobileAlt },
])

onMounted(async () => {
  // README のデスクトップ版が別のスクショに差し替わっていたときだけ追従する
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/notedeck-dev/notedeck/main/README.md',
    )
    const md = await res.text()
    const found = md.match(
      /<img[^>]+src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/,
    )
    if (found) shots.value[0].src = found[1]
  } catch {
    /* 取れなければ既定のスクショのまま */
  }
})
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
      <!-- 高さを揃えて横に並べる。横長 (デスクトップ) と縦長 (スマホ) が混ざるので幅は画像任せ -->
      <div class="intro-gallery acrylic w-secondary">
        <div class="intro-track">
          <figure v-for="(shot, i) in shots" :key="shot.src" class="intro-slide">
            <img
              :src="shot.src"
              :alt="shot.alt"
              :width="shot.width"
              :height="shot.height"
              :loading="i === 0 ? 'eager' : 'lazy'"
              decoding="async"
            />
          </figure>
        </div>
      </div>
    </div>
  </section>

  <!-- Hub .introductionTip -->
  <section class="intro-tip w-secondary">
    <p><b class="chip">TIP:</b><span>{{ t.intro.tip }}</span></p>
  </section>
</template>
