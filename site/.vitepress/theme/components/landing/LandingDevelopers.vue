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
          による状態管理。WebView は常に手元の Rust とだけ話します。
        </div>
      </div>
      <div class="arch-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
      </div>
      <div class="arch-shells">
        <div class="arch-layer acrylic">
          <div class="arch-label">殻 — Tauri v2（手元の端末）</div>
          <div class="arch-title">OS 統合 + クライアント層</div>
          <div class="arch-desc">
            ウィンドウ、トレイ、OS 通知、キーチェーン、自動更新。データ系の呼び出しは切替点 1 箇所で、同じプロセス内の notecore に渡すか (既定)、右の notenode に中継するかが決まります。フロントは違いを知りません。
          </div>
        </div>
        <div class="arch-arrow arch-arrow-h" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
          <span>中継</span>
        </div>
        <div class="arch-layer acrylic arch-shell-node">
          <div class="arch-label">殻 — notenode（自分のサーバー）</div>
          <div class="arch-title">常駐、RPC + SSE、ペアリング</div>
          <div class="arch-desc">
            同じ notecore を headless で包んだ殻。VPS や自宅サーバーで動き、端末を閉じても蓄積と AI が続き、複数の端末が同じデッキに繋がります。notedeck と同じリポジトリから出る別バイナリです。
          </div>
        </div>
      </div>
      <div class="arch-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
      </div>
      <div class="arch-layer arch-core acrylic">
        <div class="arch-label">コア</div>
        <div class="arch-title">notecore — Tauri に依存しないドメイン</div>
        <div class="arch-desc">
          Vault、クエリランタイム、AI エージェントループ、設定、認可、キャッシュ。どちらの殻に包まれても同じクレートで、動く場所が変わるだけで挙動は同じです。
        </div>
      </div>
      <div class="arch-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
      </div>
      <div class="arch-layer acrylic">
        <div class="arch-label">Misskey クライアント</div>
        <div class="arch-title">notecli — Rust ヘッドレスクライアント</div>
        <div class="arch-desc">
          Misskey API + WebSocket ストリーミング + SQLite（FTS5）。Tauri なしでも単体で動く独立ライブラリです。
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
