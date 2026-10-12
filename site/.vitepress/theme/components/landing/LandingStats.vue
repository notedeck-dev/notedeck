<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import { useRepoStats } from '../../composables/useRepoStats'

/** Hub .section_stats: acrylic の pill にチップ付きの数字を並べる。取れないときは出さない */
const { stats } = useRepoStats()
const { lang } = useData()

const format = computed(() => new Intl.NumberFormat(lang.value))
</script>

<template>
  <section v-if="stats" class="stats acrylic w-secondary">
    <div class="stats-text">
      <span><b class="chip">Stars:</b>{{ format.format(stats.stars) }}+</span>
      <span><b class="chip">Releases:</b>{{ format.format(stats.releases) }}+</span>
      <span><b class="chip">Downloads:</b>{{ format.format(stats.downloads) }}+</span>
    </div>
  </section>
</template>
