<script setup lang="ts">
import { useId } from 'vue'

/**
 * Hub IndexHeroBg 相当。輪郭のあるグラデのブロブ 2 枚が 60s / 80s で逆向きに回り、
 * スクロールに合わせて上下にパララックスする。ヒーローと特徴フレームの背景で使い回すので、
 * SVG の gradient id はインスタンスごとに振る。
 */
const id = useId()
</script>

<template>
  <div class="hero-bg" aria-hidden="true">
    <div class="hero-blob hero-blob-1">
      <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient :id="`${id}-a`" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style="stop-color: var(--accent-strong)" />
            <stop offset="1" style="stop-color: var(--accent)" />
          </linearGradient>
        </defs>
        <path
          d="M500,70 C737.5,70 930,262.5 930,500 C930,737.5 737.5,930 500,930 C262.5,930 40,760 40,522 C40,284 262.5,70 500,70 Z"
          :fill="`url(#${id}-a)`"
        />
      </svg>
    </div>
    <div class="hero-blob hero-blob-2">
      <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient :id="`${id}-b`" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style="stop-color: var(--accent); stop-opacity: 0.6" />
            <stop offset="1" style="stop-color: var(--accent-strong); stop-opacity: 0.6" />
          </linearGradient>
        </defs>
        <path
          d="M500,70 C737.5,70 960,240 960,478 C960,716 737.5,930 500,930 C262.5,930 70,737.5 70,500 C70,262.5 262.5,70 500,70 Z"
          :fill="`url(#${id}-b)`"
        />
      </svg>
    </div>
  </div>
</template>
