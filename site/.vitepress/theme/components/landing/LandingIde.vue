<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import LandingFrame from './LandingFrame.vue'

const { t } = useI18n()

const CARDS = computed(() => {
  const { store, ai, inspect, extend, grow, api } = t.value.ide
  return [
    { ...store, body: undefined, bodyHtml: store.bodyHtml },
    { ...ai, bodyHtml: undefined },
    { ...inspect, bodyHtml: undefined },
    { ...extend, bodyHtml: undefined },
    { ...grow, bodyHtml: undefined },
    { ...api, bodyHtml: undefined },
  ]
})
</script>

<template>
  <LandingFrame id="ide" label="IDE" side="right" :title="t.ide.title" :desc="t.ide.desc">
    <div class="feature-grid">
      <div v-for="card in CARDS" :key="card.title" class="feature-card acrylic">
        <h3>{{ card.title }}</h3>
        <p>
          <strong>{{ card.strong }}</strong>
          <span v-if="card.bodyHtml" v-html="card.bodyHtml" />
          <template v-else>{{ card.body }}</template>
        </p>
        <span />
      </div>
    </div>
  </LandingFrame>
</template>
