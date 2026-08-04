<script setup lang="ts">
import { useData, useRoute } from 'vitepress'
import VPNavBarSearch from 'vitepress/dist/client/theme-default/components/VPNavBarSearch.vue'
import { ref, watch } from 'vue'

/** Misskey Hub の GNav 相当。VitePress の VPNav は site.css で隠し、こちらを使う。 */

const { isDark } = useData()
const route = useRoute()

const navOpen = ref(false)
watch(
  () => route.path,
  () => {
    navOpen.value = false
  },
)

const NAV_ITEMS = [
  { text: 'ドキュメント', href: '/docs/' },
  { text: '特長', href: '/#why' },
  { text: '機能', href: '/#features' },
  { text: 'ダウンロード', href: '/#download' },
  { text: 'Store', href: 'https://store.notedeck.io' },
]
</script>

<template>
  <div class="nav-root" :class="{ 'nav-open': navOpen }">
    <div class="nav-main">
      <div class="nav-bg" />
      <nav class="nav-container">
        <button
          type="button"
          class="nav-menu-button"
          :aria-expanded="navOpen"
          aria-label="メニュー"
          @click="navOpen = !navOpen"
        >
          <svg v-if="navOpen" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>

        <a href="/" class="nav-brand">
          <img src="/favicon.png" alt="" />
          <b>Note<span class="text-gradient">Deck</span></b>
        </a>

        <div class="nav-items">
          <a v-for="item in NAV_ITEMS" :key="item.href" :href="item.href">{{ item.text }}</a>
        </div>

        <div class="nav-right">
          <VPNavBarSearch class="nav-search" />
          <button
            type="button"
            class="nav-right-button"
            aria-label="カラーモード切り替え"
            @click="isDark = !isDark"
          >
            <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
            <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
          </button>
          <a
            href="https://github.com/notedeck-dev/notedeck"
            class="nav-right-button"
            aria-label="GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
          </a>
        </div>

        <div class="nav-sp-spacer" />
      </nav>
    </div>

    <div class="nav-mobile-drawer">
      <a
        v-for="item in NAV_ITEMS"
        :key="item.href"
        :href="item.href"
        class="nav-mobile-item"
        @click="navOpen = false"
      >
        {{ item.text }}
      </a>
      <a
        href="https://github.com/notedeck-dev/notedeck"
        class="nav-mobile-item"
        @click="navOpen = false"
      >
        GitHub
      </a>
    </div>
  </div>
</template>
