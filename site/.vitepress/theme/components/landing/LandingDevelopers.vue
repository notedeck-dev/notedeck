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
      <div class="arch-box">
        <div class="arch-label">手元の端末</div>
        <div class="arch-title">Tauri v2</div>
        <div class="arch-desc">
          OS 統合。ウィンドウ、トレイ、OS 通知、キーチェーン、自動更新。WebView は手元の Rust とだけ話します。
        </div>
        <div class="arch-layer acrylic">
          <div class="arch-label">フロントエンド</div>
          <div class="arch-title">Vue 3 + Pinia</div>
          <div class="arch-desc">デッキの UI。コアがどこで動いているかを知りません。</div>
          <div class="arch-tags">
            <span>TypeScript</span><span>Vapor 準備済み</span><span>CSS Containment</span><span>Frame Scheduler</span>
          </div>
        </div>
        <div class="arch-arrow" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
          <span>IPC</span>
        </div>
        <div class="arch-layer acrylic">
          <div class="arch-label">切替点</div>
          <div class="arch-title">クライアント層</div>
          <div class="arch-desc">
            データ系の呼び出しはここ 1 箇所を通り、同じプロセスの notecore に渡すか (既定)、notecored に中継するかが決まります。
          </div>
        </div>
      </div>
      <div class="arch-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
        <span>既定は同じプロセス、リモート構成では中継</span>
      </div>
      <div class="arch-box arch-box-remote">
        <div class="arch-label">自分のサーバー (任意)</div>
        <div class="arch-title">notecored</div>
        <div class="arch-desc">
          常駐 + RPC/SSE + ペアリング。notecore を headless で包む殻。これを挟むと notecore から下は自分のサーバーで動き、端末を閉じても蓄積・通知受信・AI が続き、複数の端末が同じデッキに繋がります。挟まなければ notecore は Tauri と同じプロセスで動きます。
        </div>
        <div class="arch-box arch-core">
          <div class="arch-label">コア</div>
          <div class="arch-title">notecore</div>
          <div class="arch-desc">
            Tauri に依存しないドメイン。Vault、クエリランタイム、AI エージェントループ、設定、認可、キャッシュ。「端末が 1 台も繋がっていなくても意味を持つ処理」だけを持ち、どちらの殻に包まれても同じクレートです。
          </div>
          <div class="arch-layer acrylic">
            <div class="arch-label">Misskey クライアント</div>
            <div class="arch-title">notecli</div>
            <div class="arch-desc">
              Misskey API、WebSocket ストリーミング、SQLite (FTS5)。NoteDeck 固有のことは知らず、ライブラリとしても CLI としても単体で動きます。
            </div>
            <div class="arch-tags">
              <span>reqwest</span><span>tokio</span><span>rusqlite</span><span>axum</span>
            </div>
          </div>
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
