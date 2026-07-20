<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import type { GalleryPost, NormalizedDriveFile } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import GalleryItemMenu from '@/components/common/GalleryItemMenu.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { safeUrl } from '@/composables/useDriveFolder'
import { useServerImages } from '@/composables/useServerImages'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverIconUrl, serverInfoImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)
const isLoggedOut = computed(() => account.value?.hasToken === false)
const windowsStore = useWindowsStore()

const posts = ref<GalleryPost[]>([])
const loading = ref(false)
const error = ref<AppError | null>(null)
const hasMore = ref(true)

async function fetchGallery(older = false) {
  if (!props.column.accountId) return
  if (older && !hasMore.value) return
  loading.value = true
  error.value = null

  try {
    const untilId =
      older && posts.value.length > 0
        ? posts.value[posts.value.length - 1]?.id
        : undefined
    const result = unwrap(
      await commands.apiGetGalleryPosts(
        props.column.accountId,
        20,
        untilId ?? null,
      ),
    )
    if (older) {
      posts.value.push(...result)
    } else {
      posts.value = result
    }
    hasMore.value = result.length >= 20
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    loading.value = false
  }
}

function openDetail(post: GalleryPost) {
  if (!props.column.accountId) return
  windowsStore.open('gallery-detail', {
    accountId: props.column.accountId,
    postId: post.id,
    post,
  })
}

function isImage(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('image/')
}

// --- Item context menu (#793: #792 と同じ右クリック / 「…」 / 長押しの契約) ---
const itemMenuRef = ref<InstanceType<typeof GalleryItemMenu>>()
const menuPost = ref<GalleryPost | null>(null)

function onPostMenu(post: GalleryPost, e: MouseEvent) {
  menuPost.value = post
  itemMenuRef.value?.open(e)
}

function onPostContextMenu(post: GalleryPost, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  onPostMenu(post, e)
}

let lastScrollCheck = 0

function onScroll(e: Event) {
  const now = Date.now()
  if (now - lastScrollCheck < 200) return
  lastScrollCheck = now
  const el = e.target as HTMLElement
  if (
    el.scrollHeight - el.scrollTop - el.clientHeight < 200 &&
    !loading.value &&
    hasMore.value
  ) {
    fetchGallery(true)
  }
}

const galleryGridScrollRef = useTemplateRef<HTMLElement>('galleryGridScrollRef')
useColumnPullScroller(galleryGridScrollRef)

function scrollToTop() {
  galleryGridScrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

fetchGallery()
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? 'ギャラリー'" :theme-vars="columnThemeVars" :pull-refresh="fetchGallery" @header-click="scrollToTop" @refresh="fetchGallery()">
    <template #header-icon>
      <i class="ti ti-icons" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <div ref="galleryGridScrollRef" :class="$style.galleryGridScroll" @scroll.passive="onScroll">
      <div v-if="loading && posts.length === 0 && !isLoggedOut" :class="$style.columnLoading"><LoadingSpinner /></div>
      <ColumnEmptyState
        v-else-if="error && !isLoggedOut"
        :error="error"
        :account-id="column.accountId"
        is-error
        :image-url="serverErrorImageUrl"
        cta-label="再試行"
        cta-icon="ti-refresh"
        @cta="fetchGallery()"
      />
      <ColumnEmptyState v-else-if="posts.length === 0" message="ギャラリーの投稿がありません" :image-url="serverInfoImageUrl" />
      <template v-else>
        <div :class="$style.galleryGrid">
          <div v-for="post in posts" :key="post.id" :class="$style.cellWrap">
          <button
            class="_button"
            :class="$style.galleryGridCell"
            @click="openDetail(post)"
            @contextmenu="onPostContextMenu(post, $event)"
          >
            <div :class="$style.galleryGridThumb">
              <img
                v-if="post.files.length > 0 && isImage(post.files[0]!) && !post.isSensitive"
                :src="safeUrl(post.files[0]!.thumbnailUrl) || safeUrl(post.files[0]!.url)"
                :alt="post.title"
                :class="$style.galleryGridImg"
                loading="lazy"
              />
              <div v-else-if="post.isSensitive" :class="$style.galleryGridPlaceholder">
                <i class="ti ti-eye-off" />
              </div>
              <div v-else :class="$style.galleryGridPlaceholder">
                <i class="ti ti-photo" />
              </div>
              <div v-if="post.files.length > 1" :class="$style.galleryGridBadge">
                <i class="ti ti-stack-2" />
                {{ post.files.length }}
              </div>
            </div>
            <div :class="$style.galleryGridInfo">
              <div :class="$style.galleryGridTitle">{{ post.title }}</div>
              <div :class="$style.galleryGridFooter">
                <span v-if="post.user" :class="$style.galleryGridUser">
                  <img
                    :src="post.user.avatarUrl || '/avatar-default.svg'"
                    :class="$style.galleryGridAvatar"
                    @error="(e: Event) => (e.target as HTMLImageElement).src = '/avatar-error.svg'"
                  />
                  <MkMfm v-if="post.user.name" :text="post.user.name" :emojis="(post.user.emojis ?? undefined) as Record<string, string> | undefined" :server-host="account?.host" plain />
                  <template v-else>{{ post.user.username }}</template>
                </span>
                <span v-if="(post.likedCount ?? 0) > 0" :class="$style.galleryGridLikes">
                  <i class="ti ti-heart" /> {{ post.likedCount }}
                </span>
              </div>
            </div>
          </button>
          <button
            class="_button"
            :class="$style.cellMenuBtn"
            :aria-label="`「${post.title}」のメニュー`"
            title="メニュー"
            @click.stop="onPostMenu(post, $event)"
          >
            <i class="ti ti-dots" />
          </button>
          </div>
        </div>
        <div v-if="loading" :class="$style.columnLoading"><LoadingSpinner /></div>
      </template>
    </div>

    <GalleryItemMenu
      ref="itemMenuRef"
      :post="menuPost"
      :account-id="column.accountId"
      @open-request="openDetail"
    />
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.galleryGridScroll {
  composes: columnScroller from './column-common.module.scss';
  position: relative;
}

.galleryGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2px;
  padding: 2px;
}

.cellWrap {
  position: relative;
  /* グリッドアイテムの最小幅が内容 (nowrap タイトル) に引っ張られてはみ出すのを防ぐ */
  min-width: 0;
}

.galleryGridCell {
  display: flex;
  flex-direction: column;
  width: 100%;
  overflow: hidden;
  transition: opacity var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 160px;

  &:hover {
    opacity: 0.8;
  }
}

/* self-chain で WebView2 の _button 特異度衝突に備える。当たり判定 40px。
   タッチ環境は非表示（タップ → 詳細ウィンドウで同アクションに到達可能 — #792 §8-28）。 */
.cellMenuBtn.cellMenuBtn {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: #fff;
  font-size: 14px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity var(--nd-duration-base);
}

@media (hover: hover) {
  .cellWrap:hover .cellMenuBtn,
  .cellMenuBtn.cellMenuBtn:focus-visible {
    opacity: 0.8;

    &:hover {
      opacity: 1;
    }
  }
}

@media (hover: none) {
  .cellMenuBtn.cellMenuBtn {
    display: none;
  }
}

.galleryGridThumb {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--nd-bg);
}

.galleryGridImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.galleryGridPlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  opacity: 0.3;
}

/* 右上は「…」オーバーレイと衝突するため右下に置く（ドライブの動画バッジと同位置） */
.galleryGridBadge {
  position: absolute;
  bottom: 4px;
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

.galleryGridInfo {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.galleryGridTitle {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.galleryGridFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.galleryGridUser {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.65em;
  color: var(--nd-fg);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.galleryGridAvatar {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
}

.galleryGridLikes {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 0.65em;
  color: var(--nd-love);
  flex-shrink: 0;
}
</style>
