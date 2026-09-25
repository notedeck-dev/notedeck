<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <section id="ide" class="hub-section w-secondary">
    <div class="section-head" data-fade>
      <h2 class="section-title"><b class="u-line">{{ t.ide.title }}</b></h2>
      <p class="section-desc" v-html="t.ide.descHtml" />
    </div>
    <div class="cards-grid" data-fade>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
          </span>
          {{ t.ide.store.title }}
        </h3>
        <p><strong>{{ t.ide.store.strong }}</strong><span v-html="t.ide.store.bodyHtml" /></p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" /></svg>
          </span>
          {{ t.ide.ai.title }}
        </h3>
        <p><strong>{{ t.ide.ai.strong }}</strong>{{ t.ide.ai.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
          </span>
          {{ t.ide.inspect.title }}
        </h3>
        <p><strong>{{ t.ide.inspect.strong }}</strong>{{ t.ide.inspect.body }}</p>
      </div>
    </div>

    <div data-fade>
      <h3 class="section-subtitle"><b class="u-line">{{ t.ide.openTitle }}</b></h3>
      <p class="section-sublead">{{ t.ide.openLead }}</p>
    </div>
    <div class="cards-grid" data-fade>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
          </span>
          {{ t.ide.extend.title }}
        </h3>
        <p><strong>{{ t.ide.extend.strong }}</strong>{{ t.ide.extend.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 1-1.1 4c1.9-.6 3-1.5 3.6-2.6.6-1.2.6-2.5-.1-4.6-2.1.8-3 1.5-3.5 2.7-.2.5-.4 1.2-.4 1.8 0 0 0 0 0 0z" /></svg>
          </span>
          {{ t.ide.grow.title }}
        </h3>
        <p><strong>{{ t.ide.grow.strong }}</strong>{{ t.ide.grow.body }}</p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
          </span>
          {{ t.ide.api.title }}
        </h3>
        <p><strong>{{ t.ide.api.strong }}</strong>{{ t.ide.api.body }}</p>
      </div>
    </div>
  </section>
</template>
