<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <section class="hub-section w-secondary">
    <div class="section-head" data-fade>
      <h2 class="section-title"><b class="u-line">{{ t.more.title }}</b></h2>
    </div>
    <div class="cards-grid" data-fade>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
          </span>
          {{ t.more.keyboard.title }}
        </h3>
        <p>{{ t.more.keyboard.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
          </span>
          {{ t.more.bossKey.title }}
        </h3>
        <p>{{ t.more.bossKey.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
          </span>
          {{ t.more.mfm.title }}
        </h3>
        <p>{{ t.more.mfm.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
          </span>
          {{ t.more.preview.title }}
        </h3>
        <p>{{ t.more.preview.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
          </span>
          {{ t.more.forks.title }}
        </h3>
        <p>{{ t.more.forks.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="0.5" /><circle cx="17.5" cy="10.5" r="0.5" /><circle cx="8.5" cy="7.5" r="0.5" /><circle cx="6.5" cy="12.5" r="0.5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" /></svg>
          </span>
          {{ t.more.appearance.title }}
        </h3>
        <p>{{ t.more.appearance.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
          </span>
          {{ t.more.ads.title }}
        </h3>
        <p>{{ t.more.ads.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </span>
          {{ t.more.data.title }}
        </h3>
        <p>{{ t.more.data.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
          </span>
          {{ t.more.perf.title }}
        </h3>
        <p>{{ t.more.perf.body }}</p>
      </div>
    </div>
  </section>
</template>
