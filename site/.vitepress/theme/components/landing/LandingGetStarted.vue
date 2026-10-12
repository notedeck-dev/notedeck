<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'

const { t, localePath } = useI18n()

/** Hub .section_getStarted の 4 枚: 絵文字 + 見出し + accent ボタン */
const ITEMS = computed(() => [
  { icon: '📦', ...t.value.getStarted.download, href: '#download', external: false },
  { icon: '💡', ...t.value.getStarted.docs, href: localePath('/docs/'), external: false },
  { icon: '🪐', ...t.value.getStarted.store, href: 'https://store.notedeck.io', external: true },
  { icon: '🛠️', ...t.value.getStarted.dev, href: 'https://github.com/notedeck-dev/notedeck', external: true },
])
</script>

<template>
  <!-- Hub: dots 背景の帯の中に「はじめる」 -->
  <section id="get-started" class="dots-section get-started">
    <div class="w-secondary">
      <div data-fade>
        <div class="get-started-title acrylic">
          <h2><b class="u-line">{{ t.getStarted.title }}</b></h2>
        </div>
      </div>
      <div class="get-started-items">
        <div v-for="item in ITEMS" :key="item.href" data-fade>
          <div class="get-started-item acrylic">
            <div class="get-started-icon" aria-hidden="true">{{ item.icon }}</div>
            <b class="get-started-item-title">{{ item.title }}</b>
            <a :href="item.href" class="btn btn-accent btn-sm">
              {{ item.button }}
              <svg v-if="item.external" class="btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
              <svg v-else class="btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
