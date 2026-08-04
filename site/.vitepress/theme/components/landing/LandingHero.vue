<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{
  noticeText: string
  noticeHref: string
}>()

/** README が載せている最新スクショ。ここに書いてある URL で LCP を先に塗る。 */
const DEFAULT_SCREENSHOT =
  'https://github.com/user-attachments/assets/a9bca10d-a59d-4c35-9284-fb0534ccf886'

const screenshot = ref(DEFAULT_SCREENSHOT)

onMounted(async () => {
  // README が別のスクショに差し替わっていたときだけ追従する
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/notedeck-dev/notedeck/main/README.md',
    )
    const md = await res.text()
    const found = md.match(
      /<img[^>]+src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/,
    )
    if (found) screenshot.value = found[1]
  } catch {
    /* 取れなければ既定のスクショのまま */
  }
})
</script>

<template>
  <!-- Hub .section_top: 角丸カードにブロブ + 本文 + デッキのスクショ -->
  <section class="hero w-primary">
    <div class="hero-card">
      <!-- Hub IndexHeroBg 相当。ぼかした円ではなく輪郭のあるブロブが
           ゆっくり回り、スクロールで上下にパララックスする -->
      <div class="hero-bg" aria-hidden="true">
        <div class="hero-blob hero-blob-1">
          <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="hero-blob-grad-1" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" style="stop-color: var(--accent-strong)" />
                <stop offset="1" style="stop-color: var(--accent)" />
              </linearGradient>
            </defs>
            <path
              d="M500,70 C737.5,70 930,262.5 930,500 C930,737.5 737.5,930 500,930 C262.5,930 40,760 40,522 C40,284 262.5,70 500,70 Z"
              fill="url(#hero-blob-grad-1)"
            />
          </svg>
        </div>
        <div class="hero-blob hero-blob-2">
          <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="hero-blob-grad-2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" style="stop-color: var(--accent); stop-opacity: 0.6" />
                <stop offset="1" style="stop-color: var(--accent-strong); stop-opacity: 0.6" />
              </linearGradient>
            </defs>
            <path
              d="M500,70 C737.5,70 960,240 960,478 C960,716 737.5,930 500,930 C262.5,930 70,737.5 70,500 C70,262.5 262.5,70 500,70 Z"
              fill="url(#hero-blob-grad-2)"
            />
          </svg>
        </div>
      </div>
      <div class="hero-inner w-secondary">
        <div class="hero-copy">
          <h1>
            <img src="/favicon.png" alt="" class="hero-logo" />
            <span>Note<b class="text-gradient">Deck</b></span>
          </h1>
          <span class="chip">Misskey Pro</span>
          <p class="hero-desc">Misskey廃人のための 非公式クライアント。</p>
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
            <a href="#download" class="btn btn-accent shadow">ダウンロード</a>
            <a href="#guest" class="btn btn-plain">ログインせずに試す</a>
          </div>
        </div>
        <div class="hero-shot">
          <img
            :src="screenshot"
            alt="NoteDeck のデッキ画面 — カラムを横に並べたレイアウト"
            width="1194"
            height="793"
            fetchpriority="high"
            decoding="async"
          />
        </div>
      </div>
    </div>
  </section>
</template>
