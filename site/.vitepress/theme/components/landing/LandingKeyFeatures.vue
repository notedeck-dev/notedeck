<script setup lang="ts">
const KEY_FEATURES = [
  {
    icon: '🗂️',
    title: '全部のサーバーが、ひとつの画面に',
    lead: '通知・タイムライン・検索を',
    leadStrong: 'アカウント横断でまとめて一覧。',
    body: 'misskey.io、にじみす、すしすきー — 何鯖使っていても、ひとつのデッキにまとめて把握。カラムごとに別のアカウントを割り当てる使い方は、本家 Web のデッキにはできません。',
  },
  {
    icon: '💾',
    title: '見たノートは、手元に残る',
    lead: '流れてきたノートを、',
    leadStrong: 'アプリが自動で覚えている。',
    body: '流れたタイムラインはローカル DB に自動保存。「あのノートどこだっけ？」も全文検索で一瞬。電波がなくても読み返せて、サーバーから消えても手元には残ります。',
  },
  {
    icon: '⚡',
    title: '軽くて、速い',
    lead: 'ブラウザではなく、',
    leadStrong: 'Rust 製のネイティブアプリ。',
    body: '起動は一瞬、スクロールはなめらか、バッテリーにも優しい。開きっぱなしのブラウザタブや重いランタイムとは無縁です。',
  },
]
</script>

<template>
  <!-- Hub .section_keyFeatures: ヒーローカード下端にオーバーラップする acrylic 3 枚 -->
  <section id="why" class="keyfeatures w-secondary">
    <div
      v-for="feature in KEY_FEATURES"
      :key="feature.title"
      class="keyfeature acrylic punched"
    >
      <div class="keyfeature-icon" aria-hidden="true">{{ feature.icon }}</div>
      <h3>{{ feature.title }}</h3>
      <p class="lead">{{ feature.lead }}<strong>{{ feature.leadStrong }}</strong></p>
      <p>{{ feature.body }}</p>
    </div>
  </section>
</template>
