<script setup lang="ts">
const CAN = [
  '公開タイムライン（ローカル・グローバルなど）の閲覧',
  'チャンネル・ギャラリー・ページなど公開コンテンツの閲覧',
  'サーバー情報・カスタム絵文字・連合チャートの観察',
  'テーマやウィジェットなどローカルツールの利用',
]

const CANNOT = [
  '投稿・リアクション・フォロー',
  '通知の受信',
  'ドライブ・リスト・アンテナ・クリップの操作',
]
</script>

<template>
  <!-- can / cannot の面カード -->
  <section id="guest" class="hub-section w-secondary">
    <div class="guest-card" data-fade>
      <h2 class="section-title"><b class="u-line">ログインせずに、試せます</b></h2>
      <p class="guest-lead">
        ゲストアカウントを追加すれば、アカウント登録なしで公開コンテンツを閲覧できます。
      </p>
      <div class="guest-cols">
        <div>
          <div class="guest-col-title"><span class="chip">できること</span></div>
          <ul class="guest-list">
            <li v-for="item in CAN" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div>
          <div class="guest-col-title"><span class="chip">できないこと</span></div>
          <ul class="guest-list guest-list-no">
            <li v-for="item in CANNOT" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
      <p class="guest-foot">
        閲覧できる範囲は各サーバーの公開設定に従います。やめるときは「ゲストを削除」するだけ —
        アカウント登録もメールアドレスも要りません。
      </p>
    </div>
  </section>
</template>
