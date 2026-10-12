<script setup lang="ts">
import { useI18n } from '../../i18n'
import HeroBlobs from './HeroBlobs.vue'

defineProps<{
  noticeText: string
  noticeHref: string
}>()

const { t } = useI18n()

/** Hub の section_top_barcode 相当の飾り。バーの幅を決め打ちで並べ、下に製品名を刻む */
const BARCODE_BARS = [
  1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 2, 1, 1, 2,
  1, 3, 1, 2, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2, 1, 2,
]
const barcodeRects = (() => {
  const rects: { x: number; w: number }[] = []
  let x = 0
  for (const w of BARCODE_BARS) {
    rects.push({ x, w })
    x += w + 1.2
  }
  return { rects, width: x }
})()
</script>

<template>
  <!-- Hub .section_top: 角丸カードにブロブ + ティッカー + タグライン + アイコン -->
  <section class="hero w-primary">
    <div class="hero-card">
      <HeroBlobs />

      <!-- Hub .tickers (Servers:) ← ここではカラムの種類を流す -->
      <div class="tickers" aria-hidden="true">
        <span class="tickers-label"><b class="chip">Columns:</b></span>
        <span class="tickers-items">
          <span class="marquee">
            <span v-for="copy in 2" :key="copy" class="marquee-track">
              <span v-for="name in t.hero.columns" :key="name" class="tickers-item">{{ name }}</span>
            </span>
          </span>
        </span>
      </div>

      <div class="hero-inner w-secondary">
        <div class="hero-copy">
          <!-- Hub .section_top_tagline (Create. Connect. with Misskey.) -->
          <h1 class="hero-tagline">
            <strong>Every server.<br />Every note.<br />in <b class="text-gradient">NoteDeck</b>.</strong>
          </h1>
          <div class="hero-sub">
            <span class="chip">Misskey Pro</span>
            <p class="hero-desc">{{ t.hero.desc }}</p>
          </div>
          <a class="notice" :href="noticeHref">
            <span class="notice-inner">
              <span class="notice-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 11-5.8-1.6" /></svg>
              </span>
              <span>{{ noticeText }}</span>
              <svg class="notice-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
            </span>
          </a>
          <div class="hero-buttons">
            <a href="#download" class="btn btn-accent shadow">{{ t.hero.download }}</a>
            <a href="#guest" class="btn btn-plain">{{ t.hero.tryGuest }}</a>
          </div>
        </div>
        <!-- Hub の Mi3d (回るロゴ) の位置。アプリアイコンをゆっくり浮かせる -->
        <div class="hero-visual" aria-hidden="true">
          <img src="/icon-512.png" alt="" class="hero-icon" width="512" height="512" fetchpriority="high" decoding="async" />
        </div>
      </div>

      <svg
        class="hero-barcode"
        :viewBox="`0 0 ${barcodeRects.width} 32`"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect v-for="r in barcodeRects.rects" :key="r.x" :x="r.x" y="0" :width="r.w" height="20" />
        <text
          :x="barcodeRects.width / 2"
          y="30"
          text-anchor="middle"
          font-family="ui-monospace, monospace"
          font-size="7"
          font-weight="700"
          letter-spacing="2.2"
        >NOTEDECK</text>
      </svg>
    </div>
  </section>
</template>
