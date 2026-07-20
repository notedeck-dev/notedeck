<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useTabSlide } from '@/composables/useTabSlide'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverIconUrl, serverInfoImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)
const windowsStore = useWindowsStore()

type Tab = 'featured' | 'my' | 'likes'
const TAB_DEFS: ColumnTabDef[] = [
  { value: 'featured', label: '人気' },
  { value: 'my', label: '自分の' },
  { value: 'likes', label: 'いいね' },
]
const tabs: Tab[] = TAB_DEFS.map((t) => t.value as Tab)
const activeTab = ref<Tab>('featured')
const listContentRef = ref<HTMLElement | null>(null)

interface FlashSummary {
  id: string
  title: string
  summary: string
  userId: string
  user: {
    username: string
    host: string | null
    name: string | null
    avatarUrl: string | null
    emojis?: Record<string, string>
  }
  likedCount: number
  isLiked?: boolean
  createdAt: string
}

const listItems = ref<FlashSummary[]>([])
const listLoading = ref(false)
const listError = ref<AppError | null>(null)

async function fetchList(tab?: Tab) {
  if (!props.column.accountId) return
  const t = tab ?? activeTab.value
  activeTab.value = t
  listLoading.value = true
  listError.value = null
  listItems.value = []

  const endpointMap: Record<Tab, string> = {
    featured: 'flash/featured',
    my: 'flash/my',
    likes: 'flash/my-likes',
  }

  try {
    const raw = unwrap(
      await commands.apiGetFlashes(props.column.accountId, endpointMap[t], 30),
    ) as unknown as FlashSummary[] | { id: string; flash: FlashSummary }[]
    // flash/my-likes returns { id, flash } wrapper objects
    listItems.value =
      t === 'likes'
        ? (raw as { id: string; flash: FlashSummary }[]).map(
            (item) => item.flash,
          )
        : (raw as FlashSummary[])
  } catch (e) {
    listError.value = AppError.from(e)
  } finally {
    listLoading.value = false
  }
}

function openPlay(flashId: string) {
  if (!props.column.accountId) return
  windowsStore.open('play-detail', {
    accountId: props.column.accountId,
    flashId,
  })
}

if (props.column.flashId) {
  openPlay(props.column.flashId)
}
fetchList()

const playTabIndex = computed(() => tabs.indexOf(activeTab.value))
useTabSlide(playTabIndex, listContentRef)

function switchTab(tab: string) {
  fetchList(tab as Tab)
}

const playListRef = useTemplateRef<HTMLElement>('playListRef')
useColumnPullScroller(playListRef)

function scrollToTop() {
  playListRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? 'Play'" :theme-vars="columnThemeVars" :pull-refresh="fetchList" @header-click="scrollToTop" @refresh="fetchList()">
    <template #header-icon>
      <i class="ti ti-player-play" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <div ref="listContentRef" :class="$style.playListContent">
      <ColumnTabs
        :tabs="TAB_DEFS"
        :model-value="activeTab"
        :swipe-target="listContentRef"
        @update:model-value="switchTab"
      />

      <div ref="playListRef" :class="$style.playList">
        <div v-if="listLoading" :class="$style.columnLoading"><LoadingSpinner /></div>
        <ColumnEmptyState
          v-else-if="listError"
          :error="listError"
          :account-id="column.accountId"
          is-error
          :image-url="serverErrorImageUrl"
          cta-label="再試行"
          cta-icon="ti-refresh"
          @cta="fetchList()"
        />
        <ColumnEmptyState v-else-if="listItems.length === 0" message="Playが見つかりません" :image-url="serverInfoImageUrl" />
        <button
          v-for="item in listItems"
          :key="item.id"
          class="_button"
          :class="$style.playCard"
          @click="openPlay(item.id)"
        >
          <div :class="$style.playCardInfo">
            <div :class="$style.playCardTitle">{{ item.title }}</div>
            <div v-if="item.summary" :class="$style.playCardSummary">{{ item.summary }}</div>
            <div :class="$style.playCardMeta">
              <img :src="item.user.avatarUrl || '/avatar-default.svg'" :class="$style.playCardAvatar" @error="(e: Event) => (e.target as HTMLImageElement).src = '/avatar-error.svg'" />
              <span :class="$style.playCardAuthor">
                <MkMfm v-if="item.user.name" :text="item.user.name" :emojis="item.user.emojis" :server-host="account?.host" plain />
                <template v-else>{{ item.user.username }}</template>
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use "./column-common.module.scss";

.playListContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.playList {
  composes: columnScroller from './column-common.module.scss';
}

/* Self-nested for specificity 0,2,0 to beat ._button (0,1,0) regardless of
   CSS chunk load order (padding が 0 に潰れて余白が消える問題, #669)。 */
.playCard.playCard {
  display: flex;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--nd-divider);
  transition: background var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 65px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.playCardInfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.playCardTitle {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.playCardSummary {
  font-size: 0.8em;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.playCardMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  opacity: 0.6;
}

.playCardAvatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
}

.playCardAuthor {
  /* placeholder */
}
</style>
