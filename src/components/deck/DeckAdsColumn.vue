<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MkAd from '@/components/common/MkAd.vue'
import { useAds } from '@/composables/useAds'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()

const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.column.accountId),
)

const { columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)

const serverIconUrl = ref<string | undefined>()
const isLoading = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
useColumnPullScroller(scrollContainer)

const { ads, serverHost, fetchAds } = useAds(
  () => props.column.accountId ?? undefined,
  { filterPlace: false, ignoreMute: true },
)

function scrollToTop() {
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

async function load() {
  const acc = account.value
  if (!acc) return

  isLoading.value = true
  try {
    const info = await serversStore.getServerInfo(acc.host)
    serverIconUrl.value = info.iconUrl
    await fetchAds()
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? '広告'"
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

    <ColumnEmptyState v-if="ads.length === 0 && !isLoading" message="広告はありません" :image-url="serverInfoImageUrl" />

    <div v-else ref="scrollContainer" :class="$style.adsBody">
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
