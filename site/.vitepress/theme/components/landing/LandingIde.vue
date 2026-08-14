<template>
  <section id="ide" class="hub-section w-secondary">
    <div class="section-head" data-fade>
      <h2 class="section-title"><b class="u-line">実は、これ「IDE」なんです</b></h2>
      <p class="section-desc">
        NoteDeck の正体は <strong>Misskey 統合デッキ環境</strong> (Integrated Deck Environment)
      </p>
    </div>
    <div class="cards-grid" data-fade>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
          </span>
          ストアで、着せ替えと機能追加
        </h3>
        <p>
          <strong>プラグイン・テーマ・ウィジットをワンクリックで。</strong>専用ストア
          <a href="https://store.notedeck.io">misstore</a>
          から直接インストールして、アカウントごとに ON/OFF。AiScript
          エディタとライブプレビューも内蔵し、自作したものはその場で動きます。
        </p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" /></svg>
          </span>
          AI が、デッキに棲む
        </h3>
        <p>
          <strong>要約も投稿もリアクションも、頼める相棒。</strong>AI チャット専用カラムに加え、ノートメニューから直接 AI
          アクション。書き込む前には必ず確認してくれるので勝手には動きません。留守の間の定期チェックも。Anthropic
          / OpenAI / xAI / Google / OpenRouter などから自由に選べます。使うかどうかは任意 — 自分の API
          キーを繋いだときだけ有効になり、無くても他の機能はすべて使えます。
        </p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
          </span>
          中身が、ぜんぶ見える
        </h3>
        <p>
          <strong>Misskey の裏側を、そのまま観察できる。</strong>サーバーとのやり取りをリアルタイムで覗けるインスペクタや、ノートの生データ（Raw
          JSON）ビューを内蔵。機密フィールドは自動マスク。Misskey の仕組みを学ぶ最短ルートです。
        </p>
      </div>
    </div>

    <div data-fade>
      <h3 class="section-subtitle"><b class="u-line">閉じた箱ではなく、開いた箱</b></h3>
      <p class="section-sublead">出荷時の機能で終わらない。使う人の手で広がっていくために。</p>
    </div>
    <div class="cards-grid" data-fade>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
          </span>
          自分で拡張できる
        </h3>
        <p>
          <strong>新しいコマンドを書けば、その場でデッキの機能になる。</strong>AiScript
          で書いたコマンドは即コマンドパレットに載り、AI
          のツールとしても使える。翻訳・天気・GitHub
          など外部のサービスも取り込めます。鍵が要るサービスも安全に登録でき、中身が AI
          に見られることはありません。
        </p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 1-1.1 4c1.9-.6 3-1.5 3.6-2.6.6-1.2.6-2.5-.1-4.6-2.1.8-3 1.5-3.5 2.7-.2.5-.4 1.2-.4 1.8 0 0 0 0 0 0z" /></svg>
          </span>
          AI と一緒に育つ
        </h3>
        <p>
          <strong>使うほど、自分専用の道具に育っていく。</strong>テーマ・キーバインドから AI
          自身のペルソナまで、AI
          が会話から直接編集。カラム追加やアカウント切替などの UI
          操作も代行し、操作した場所は光って見える。覚えたことは次の会話にも引き継がれます。
        </p>
      </div>
      <div class="card acrylic">
        <h3>
          <span class="card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
          </span>
          外部からも動かせる
        </h3>
        <p>
          <strong>物理ボタンも CLI も AI も、同じ入口から。</strong>ローカル API
          でデッキを丸ごと操作 —
          投稿もタイムライン取得もカラム操作も。Raycast・Obsidian・Stream Deck から AI
          エージェントまで、一度書けばどこからでも呼べます。
        </p>
      </div>
    </div>
  </section>
</template>
