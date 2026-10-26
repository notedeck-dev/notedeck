<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Page } from '@/bindings'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { i18n } from '@/i18n'
import { useWindowsStore } from '@/stores/windows'
import ProfileItemCards from './ProfileItemCards.vue'

const props = defineProps<{
  accountId: string
  userId: string
  active: boolean
  infoImageUrl?: string
  errorImageUrl?: string
}>()

const { apiFor } = useMultiAccountAdapters()

const PAGE_SIZE = 20

const windowsStore = useWindowsStore()

const {
  items: userPages,
  isLoading,
  error,
  load,
  loadMore,
} = usePaginatedList<Page>({
  fetch: async (untilId) => {
    return (await apiFor(props.accountId)).getUserPagesBy(props.userId, {
      limit: PAGE_SIZE,
      untilId,
    })
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
  userPages.value.map((p) => ({
    id: p.id,
    title: p.title,
    summary: p.summary,
  })),
)

function openUserPage(pageId: string) {
  windowsStore.open('page-detail', {
    accountId: props.accountId,
    pageId,
  })
}
</script>

<template>
  <div v-show="active" :class="$style.pane">
    <ProfileItemCards
      :cards="cards"
      :is-loading="isLoading"
      :error="error"
      :empty-message="i18n.ts._userProfilePagesPane.empty"
      :info-image-url="infoImageUrl"
      :error-image-url="errorImageUrl"
      @select="openUserPage"
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
