<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Clip, JsonValue } from '@/bindings'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { i18n } from '@/i18n'
import { useWindowsStore } from '@/stores/windows'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ProfileItemCards from './ProfileItemCards.vue'

const props = defineProps<{
  accountId: string
  userId: string
  isOwnProfile: boolean
  active: boolean
  infoImageUrl?: string
  errorImageUrl?: string
}>()

const PAGE_SIZE = 20

const windowsStore = useWindowsStore()

// 自プロフィールは clips/list（非公開含む全クリップ、ページング不可）、
// 他プロフィールは users/clips（公開のみ、limit/untilId ページング）。
const {
  items: profileClips,
  isLoading,
  error,
  load,
  loadMore,
} = usePaginatedList<Clip>({
  fetch: async (untilId) => {
    if (props.isOwnProfile) {
      // clips/list はページング非対応。loadMore からの呼び出し (untilId あり)
      // では常に空を返して打ち切る。
      if (untilId) return []
      return unwrap(await commands.apiGetClips(props.accountId))
    }
    const params: Record<string, JsonValue> = {
      userId: props.userId,
      limit: PAGE_SIZE,
    }
    if (untilId) params.untilId = untilId
    return unwrap(await commands.apiGetUserClips(props.accountId, params))
  },
  pageSize: PAGE_SIZE,
  // 自プロフィールの clips/list はページング非対応 — 初回で全件取得済み
  initialHasMore: (fetched) =>
    !props.isOwnProfile && fetched.length >= PAGE_SIZE,
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
  profileClips.value.map((c) => ({
    id: c.id,
    title: c.name,
    summary: c.description,
  })),
)

function openClip(clipId: string) {
  windowsStore.open('clip-detail', {
    accountId: props.accountId,
    clipId,
  })
}
</script>

<template>
  <div v-show="active" :class="$style.pane">
    <ProfileItemCards
      :cards="cards"
      :is-loading="isLoading"
      :error="error"
      :empty-message="i18n.ts._userProfileClipsPane.empty"
      :info-image-url="infoImageUrl"
      :error-image-url="errorImageUrl"
      @select="openClip"
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
