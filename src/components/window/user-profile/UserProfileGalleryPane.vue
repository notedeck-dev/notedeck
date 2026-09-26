<script setup lang="ts">
import { watch } from 'vue'
import type { GalleryPost, JsonValue } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { safeUrl } from '@/composables/useDriveFolder'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { i18n } from '@/i18n'
import { useWindowsStore } from '@/stores/windows'
import { commands, unwrap } from '@/utils/tauriInvoke'

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
  items: userGalleryPosts,
  isLoading,
  error,
  load,
  loadMore,
} = usePaginatedList<GalleryPost>({
  fetch: async (untilId) => {
    const params: Record<string, JsonValue> = {
      userId: props.userId,
      limit: PAGE_SIZE,
    }
    if (untilId) params.untilId = untilId
    return unwrap(await commands.apiGetUserGalleryBy(props.accountId, params))
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

function openUserGallery(post: GalleryPost) {
  windowsStore.open('gallery-detail', {
    accountId: props.accountId,
    postId: post.id,
    post,
  })
}
</script>

<template>
  <div v-show="active" :class="$style.pane">
    <div v-if="userGalleryPosts.length > 0" :class="$style.grid">
      <button
        v-for="post in userGalleryPosts"
        :key="post.id"
        class="_button"
        :class="$style.gridCell"
        @click="openUserGallery(post)"
      >
        <div :class="$style.gridThumb">
          <img
            v-if="post.files.length > 0 && post.files[0]!.type.startsWith('image/') && !post.isSensitive"
            :src="safeUrl(post.files[0]!.thumbnailUrl) || safeUrl(post.files[0]!.url)"
            :alt="post.title"
            :class="$style.gridImg"
            loading="lazy"
          />
          <div v-else-if="post.isSensitive" :class="$style.gridPlaceholder">
            <i class="ti ti-eye-off" />
          </div>
          <div v-else :class="$style.gridPlaceholder">
            <i class="ti ti-photo" />
          </div>
          <div v-if="post.files.length > 1" :class="$style.gridBadge">
            <i class="ti ti-stack-2" />
            {{ post.files.length }}
          </div>
        </div>
        <div :class="$style.gridInfo">
          <div :class="$style.gridTitle">{{ post.title }}</div>
          <div v-if="(post.likedCount ?? 0) > 0" :class="$style.gridLikes">
            <i class="ti ti-heart" /> {{ post.likedCount }}
          </div>
        </div>
      </button>
    </div>

    <div v-if="isLoading" :class="$style.stateMessage">
      <LoadingSpinner />
    </div>
    <ColumnEmptyState
      v-else-if="error"
      :message="error"
      is-error
      :image-url="errorImageUrl"
    />
    <ColumnEmptyState
      v-else-if="userGalleryPosts.length === 0"
      :message="i18n.ts._userProfileGalleryPane.empty"
      :image-url="infoImageUrl"
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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 2px;
  padding: 2px;
}

.gridCell {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  text-align: left;
  transition: opacity var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;

  &:hover {
    opacity: 0.8;
  }
}

.gridThumb {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--nd-bg);
}

.gridImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gridPlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  opacity: 0.3;
}

.gridBadge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--nd-overlayDark);
  color: #fff;
  font-size: 11px;
}

.gridInfo {
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.gridTitle {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.gridLikes {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 0.65em;
  color: var(--nd-love);
  flex-shrink: 0;
}

.stateMessage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 0.9em;
}
</style>
