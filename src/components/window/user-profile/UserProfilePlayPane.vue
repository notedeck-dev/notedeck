<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Flash, JsonValue } from '@/bindings'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { i18n } from '@/i18n'
import { useWindowsStore } from '@/stores/windows'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ProfileItemCards from './ProfileItemCards.vue'

const props = defineProps<{
  accountId: string
  userId: string
  active: boolean
  infoImageUrl?: string
  errorImageUrl?: string
}>()

const PAGE_SIZE = 20

const windowsStore = useWindowsStore()

const {
  items: userFlashes,
  isLoading,
  error,
  load,
  loadMore,
} = usePaginatedList<Flash>({
  fetch: async (untilId) => {
    const params: Record<string, JsonValue> = {
      userId: props.userId,
      limit: PAGE_SIZE,
    }
    if (untilId) params.untilId = untilId
    // Misskey API のエンドポイント名は "users/flashs"（本家のスペルミス）。
    // "users/flashes" だと 404 を返す。
    return unwrap(await commands.apiGetUserFlashs(props.accountId, params))
  },
  pageSize: PAGE_SIZE,
})

watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)

defineExpose({ loadMore })

const cards = computed(() =>
  userFlashes.value.map((f) => ({
    id: f.id,
    title: f.title,
    summary: f.summary,
  })),
)

function openUserPlay(flashId: string) {
  windowsStore.open('play-detail', {
    accountId: props.accountId,
    flashId,
  })
}
</script>

<template>
  <div v-show="active" :class="$style.pane">
    <ProfileItemCards
      :cards="cards"
      :is-loading="isLoading"
      :error="error"
      :empty-message="i18n.ts._userProfilePlayPane.empty"
      :info-image-url="infoImageUrl"
      :error-image-url="errorImageUrl"
      @select="openUserPlay"
    />
  </div>
</template>

<style lang="scss" module>
.pane {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
</style>
