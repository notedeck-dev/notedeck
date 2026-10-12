<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()

const ICONS = ['🏠', '💾', '👀', '🧪']
</script>

<template>
  <!-- Hub .section_useCases: 緑の縁取りカード 4 枚 (絵文字 + ラベルチップ + 一文) -->
  <section class="use-cases w-primary">
    <div class="w-secondary">
      <div data-fade>
        <h2 class="use-cases-title">{{ t.useCases.title }}</h2>
      </div>
      <div class="use-cases-items">
        <div v-for="(item, i) in t.useCases.items" :key="item.label" data-fade>
          <div class="use-case punched">
            <div class="use-case-icon" aria-hidden="true">{{ ICONS[i] }}</div>
            <b class="chip use-case-label">{{ item.label }}</b>
            <h3 class="use-case-title">{{ item.title }}</h3>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
