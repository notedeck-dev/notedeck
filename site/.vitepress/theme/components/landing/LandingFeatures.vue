<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import LandingFrame from './LandingFrame.vue'

const { t } = useI18n()

/** Hub features_items: 見出し + 本文の acrylic カードを auto-fill で流す。
 *  先頭 3 枚 (デッキ / オフライン / あんしん) は箇条書きつき */
const CARDS = computed(() => {
  const { deck, offline, security } = t.value.features
  const more = t.value.more
  return [
    { ...deck, html: undefined },
    { ...offline, html: undefined },
    { ...security, html: security.policyHtml },
    ...Object.values(more).map((card) => ({ ...card, chip: undefined, list: undefined, html: undefined })),
  ]
})
</script>

<template>
  <LandingFrame id="features" label="FEATURES" side="left" :title="t.features.title" :desc="t.features.desc">
    <div class="feature-grid">
      <div v-for="card in CARDS" :key="card.title" class="feature-card acrylic">
        <h3>
          <span v-if="card.chip" class="chip">{{ card.chip }}</span>
          {{ card.title }}
        </h3>
        <p>{{ card.body }}</p>
        <ul v-if="card.list" class="card-list">
          <li v-for="item in card.list" :key="item">{{ item }}</li>
          <li v-if="card.html" v-html="card.html" />
        </ul>
        <span v-else />
      </div>
    </div>
  </LandingFrame>
</template>
