<script setup lang="ts">
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
      <h2 class="section-title"><b class="u-line">開発者のみなさんへ</b></h2>
      <p class="section-desc">
        NoteDeck はオープンソース (AGPL-3.0)。本家と同じ Vue 3 + TypeScript
        なので、本家のコードが読める人ならそのまま読めます。
      </p>
    </div>
    <div class="arch-grid" data-fade>
      <div class="arch-layer acrylic">
        <div class="arch-label">フロントエンド</div>
        <div class="arch-title">Vue 3 + TypeScript</div>
        <div class="arch-desc">
          Vapor モード移行準備済み。CSS Containment、Frame Scheduler で描画最適化。Pinia
          による状態管理。
        </div>
      </div>
      <div class="arch-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
      </div>
      <div class="arch-layer acrylic">
        <div class="arch-label">Tauri v2 ブリッジ</div>
        <div class="arch-title">Rust — 薄いラッパー</div>
        <div class="arch-desc">
          グローバルホットキー、システムトレイ、OS キーチェーン、自動アップデート。WebView
          とプロセス分離でセキュリティを確保。
        </div>
      </div>
      <div class="arch-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
      </div>
      <div class="arch-layer arch-core acrylic">
        <div class="arch-label">コア</div>
        <div class="arch-title">notecli — Rust ヘッドレスクライアント</div>
        <div class="arch-desc">
          Misskey API + WebSocket ストリーミング + SQLite（FTS5）+ localhost HTTP API。Tauri
          なしでも単体動作する独立ライブラリ。
        </div>
        <div class="arch-tags">
          <span>reqwest</span><span>tokio</span><span>rusqlite</span><span>axum</span>
        </div>
      </div>
    </div>

    <div class="fork-cta" data-fade>
      <h3>あなたの鯖の独自機能を、NoteDeck に</h3>
      <p>
        フォークごとの違いは<strong>アダプター</strong>が引き受けます。使えない独自機能があれば教えてください（対象は
        Misskey を名乗り続けるフォーク）。
      </p>
      <a :href="`${REPO}/issues/new?template=fork_support.yml`" class="btn btn-accent">
        対応を依頼する
      </a>
    </div>

    <div class="arch-tags arch-doc-links" data-fade>
      <a v-for="link in DOC_LINKS" :key="link.file" :href="`${REPO}/blob/main/${link.file}`">
        {{ link.text }}
      </a>
    </div>
  </section>
</template>
