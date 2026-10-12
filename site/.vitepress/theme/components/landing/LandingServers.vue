<script setup lang="ts">
import { useI18n } from '../../i18n'

const { t } = useI18n()

const FORK_REQUEST =
  'https://github.com/notedeck-dev/notedeck/issues/new?template=fork_support.yml'
</script>

<template>
  <!-- Hub .section_decentralized: 面カードの本文 + ボタン。フォーク対応の依頼はここに -->
  <section id="servers" class="servers w-secondary">
    <div data-fade="left">
      <div class="servers-content">
        <h2 class="servers-title"><b class="u-line">{{ t.servers.title }}</b></h2>
        <p class="servers-desc">{{ t.servers.desc }}</p>
        <div class="servers-fork tint-card">
          <h3>{{ t.servers.forkTitle }}</h3>
          <p v-html="t.servers.forkBodyHtml" />
          <a :href="FORK_REQUEST" class="btn btn-accent">{{ t.servers.forkButton }}</a>
        </div>
      </div>
    </div>
  </section>
</template>
