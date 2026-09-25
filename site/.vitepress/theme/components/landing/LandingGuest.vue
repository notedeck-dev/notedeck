<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <!-- can / cannot の面カード -->
  <section id="guest" class="hub-section w-secondary">
    <div class="guest-card" data-fade>
      <h2 class="section-title"><b class="u-line">{{ t.guest.title }}</b></h2>
      <p class="guest-lead">{{ t.guest.lead }}</p>
      <div class="guest-cols">
        <div>
          <div class="guest-col-title"><span class="chip">{{ t.guest.canLabel }}</span></div>
          <ul class="guest-list">
            <li v-for="item in t.guest.can" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div>
          <div class="guest-col-title"><span class="chip">{{ t.guest.cannotLabel }}</span></div>
          <ul class="guest-list guest-list-no">
            <li v-for="item in t.guest.cannot" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
      <p class="guest-foot">{{ t.guest.foot }}</p>
    </div>
  </section>
</template>
