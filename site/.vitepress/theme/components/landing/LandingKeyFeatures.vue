<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <!-- Hub .section_keyFeatures: ヒーローカード下端にオーバーラップする acrylic 3 枚 -->
  <section id="why" class="keyfeatures w-secondary">
    <div
      v-for="feature in t.keyFeatures"
      :key="feature.title"
      class="keyfeature acrylic punched"
    >
      <div class="keyfeature-icon" aria-hidden="true">{{ feature.icon }}</div>
      <h3>{{ feature.title }}</h3>
      <p class="lead">{{ feature.lead }}<strong>{{ feature.leadStrong }}</strong></p>
      <p>{{ feature.body }}</p>
    </div>
  </section>
</template>
