<script setup lang="ts">
import { useI18n } from '../../i18n'
import LandingFrame from './LandingFrame.vue'

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
  <LandingFrame id="dev" label="DEVELOPERS" side="left" :title="t.developers.title" :desc="t.developers.desc">
    <!-- 縦 1 列の構成図: 手元の端末 (Tauri) → notecore → notecli。
         Tauri と notecore の間は 2 経路で、左の縦線が「素通り (既定)」、
         右が notemaid (任意、点線) を経由する「中継」 -->
    <div class="arch-grid">
      <div class="arch-box acrylic">
        <div class="arch-label">{{ t.developers.device.label }}</div>
        <div class="arch-title">Tauri v2</div>
        <div class="arch-desc">{{ t.developers.device.desc }}</div>
        <div class="arch-layer">
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
            <div class="arch-title">notemaid</div>
            <div class="arch-desc">{{ t.developers.remote.desc }}</div>
          </div>
          <div class="arch-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
          </div>
        </div>
      </div>
      <div class="arch-box acrylic">
        <div class="arch-label">{{ t.developers.core.label }}</div>
        <div class="arch-title">notecore</div>
        <div class="arch-desc">{{ t.developers.core.desc }}</div>
        <div class="arch-layer arch-highlight">
          <div class="arch-label">{{ t.developers.client.label }}</div>
          <div class="arch-title">notecli</div>
          <div class="arch-desc">{{ t.developers.client.desc }}</div>
          <div class="arch-tags">
            <span>reqwest</span><span>tokio</span><span>rusqlite</span><span>axum</span>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-tags arch-doc-links">
      <a v-for="link in DOC_LINKS" :key="link.file" :href="`${REPO}/blob/main/${link.file}`">
        {{ link.text }}
      </a>
    </div>
  </LandingFrame>
</template>
