<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <!-- Hub features セクション: 中央見出し + acrylic カードグリッド -->
  <section id="features" class="hub-section w-secondary">
    <div class="section-head" data-fade>
      <h2 class="section-title"><b class="u-line">{{ t.features.title }}</b></h2>
    </div>
    <div class="cards-grid" data-fade>
      <div
        v-for="card in [t.features.deck, t.features.offline, t.features.security]"
        :key="card.chip"
        class="card acrylic"
      >
        <span class="chip">{{ card.chip }}</span>
        <h3>{{ card.title }}</h3>
        <p>{{ card.body }}</p>
        <ul class="card-list">
          <li v-for="item in card.list" :key="item">{{ item }}</li>
          <li v-if="card === t.features.security" v-html="t.features.security.policyHtml" />
        </ul>
      </div>
    </div>
  </section>
</template>
