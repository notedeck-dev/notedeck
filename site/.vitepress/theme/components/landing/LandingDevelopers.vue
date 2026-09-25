<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()

const REPO = 'https://github.com/notedeck-dev/notedeck'

const DOC_LINKS = [
  { text: 'Architecture', file: 'ARCHITECTURE.md' },
  { text: 'Development', file: 'DEVELOPMENT.md' },
  { text: 'Strategy', file: 'STRATEGY.md' },
  { text: 'Contributing', file: 'CONTRIBUTING.md' },
]
</script>

<template>
  <section id="dev" class="hub-section w-secondary">
    <div class="section-head" data-fade>
      <h2 class="section-title"><b class="u-line">{{ t.developers.title }}</b></h2>
      <p class="section-desc">{{ t.developers.desc }}</p>
    </div>
    <div class="arch-grid" data-fade>
      <div class="arch-box">
        <div class="arch-label">{{ t.developers.device.label }}</div>
        <div class="arch-title">Tauri v2</div>
        <div class="arch-desc">{{ t.developers.device.desc }}</div>
        <div class="arch-layer acrylic">
          <div class="arch-label">{{ t.developers.frontend.label }}</div>
          <div class="arch-title">Vue 3 + Pinia</div>
          <div class="arch-desc">{{ t.developers.frontend.desc }}</div>
          <div class="arch-tags">
            <span>TypeScript</span><span>{{ t.developers.frontend.vaporTag }}</span><span>CSS Containment</span><span>Frame Scheduler</span>
          </div>
        </div>
      </div>
      <div class="arch-fork">
        <div class="arch-bypass" aria-hidden="true">
          <div class="arch-bypass-line"></div>
          <svg width="24" height="12" viewBox="0 6 24 12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="19 8 12 15 5 8" /></svg>
        </div>
        <div class="arch-via">
          <div class="arch-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
          </div>
          <div class="arch-box arch-box-remote">
            <div class="arch-label">{{ t.developers.remote.label }}</div>
            <div class="arch-title">notecored</div>
            <div class="arch-desc">{{ t.developers.remote.desc }}</div>
          </div>
          <div class="arch-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
          </div>
        </div>
      </div>
      <div class="arch-box">
        <div class="arch-label">{{ t.developers.core.label }}</div>
        <div class="arch-title">notecore</div>
        <div class="arch-desc">{{ t.developers.core.desc }}</div>
        <div class="arch-layer acrylic arch-highlight">
          <div class="arch-label">{{ t.developers.client.label }}</div>
          <div class="arch-title">notecli</div>
          <div class="arch-desc">{{ t.developers.client.desc }}</div>
          <div class="arch-tags">
            <span>reqwest</span><span>tokio</span><span>rusqlite</span><span>axum</span>
          </div>
        </div>
      </div>
    </div>

    <div class="fork-cta" data-fade>
      <h3>{{ t.developers.forkTitle }}</h3>
      <p v-html="t.developers.forkBodyHtml" />
      <a :href="`${REPO}/issues/new?template=fork_support.yml`" class="btn btn-accent">
        {{ t.developers.forkButton }}
      </a>
    </div>

    <div class="arch-tags arch-doc-links" data-fade>
      <a v-for="link in DOC_LINKS" :key="link.file" :href="`${REPO}/blob/main/${link.file}`">
        {{ link.text }}
      </a>
    </div>
  </section>
</template>
