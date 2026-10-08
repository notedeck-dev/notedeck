<script setup lang="ts">
import { onMounted } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MkAd from '@/components/common/MkAd.vue'
import { useAds } from '@/composables/useAds'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const {
  account,
  columnThemeVars,
  serverInfoImageUrl,
  isLoading,
  withLoading,
  scroller,
  scrollToTop,
} = useColumnSetup(() => props.column)
useColumnPullScroller(scroller)

const { ads, serverHost, fetchAds } = useAds(
  () => props.column.accountId ?? undefined,
  { filterPlace: false, ignoreMute: true },
)

async function load() {
  if (!account.value) return
  await withLoading(() => fetchAds())
}

onMounted(() => {
  load()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? i18n.ts._columns.ads"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="load"
    @refresh="load"
  >
    <template #header-icon>
      <i class="ti ti-ad-2" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
    </template>

    <ColumnEmptyState v-if="ads.length === 0 && !isLoading" :message="i18n.ts._deckAdsColumn.empty" :image-url="serverInfoImageUrl" />

    <div v-else ref="scroller" :class="$style.adsBody">
      <MkAd
        v-for="ad in ads"
        :key="ad.id"
        :ad="ad"
        :server-host="serverHost"
        :show-mute-button="false"
      />
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.adsBody {
  composes: columnScroller from './column-common.module.scss';
}
</style>
