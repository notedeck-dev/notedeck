<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import type { Page } from '@/bindings'
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

const listItems = ref<Page[]>([])
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
    featured: 'pages/featured',
    my: 'i/pages',
    likes: 'i/page-likes',
  }

  try {
    // i/page-likes wrapper は Rust 側で剥がして Page[] に統一済み。
    listItems.value = unwrap(
      await commands.apiGetPages(props.column.accountId, endpointMap[t], 30),
    )
  } catch (e) {
    listError.value = AppError.from(e)
  } finally {
    listLoading.value = false
  }
}

function openPage(pageId: string) {
  if (!props.column.accountId) return
  windowsStore.open('page-detail', {
    accountId: props.column.accountId,
    pageId,
  })
}

// pageId が指定されたカラムは初期表示でウィンドウを開く
if (props.column.pageId) {
  openPage(props.column.pageId)
}
fetchList()

// Tab slide animation
const pageTabIndex = computed(() => tabs.indexOf(activeTab.value))
useTabSlide(pageTabIndex, listContentRef)

function switchTab(tab: string) {
  fetchList(tab as Tab)
}

const pageListRef = useTemplateRef<HTMLElement>('pageListRef')
useColumnPullScroller(pageListRef)

function scrollToTop() {
  pageListRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? 'ページ'" :theme-vars="columnThemeVars" :pull-refresh="fetchList" @header-click="scrollToTop" @refresh="fetchList()">
    <template #header-icon>
      <i class="ti ti-note" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <div ref="listContentRef" :class="$style.pageListContent">
      <ColumnTabs
        :tabs="TAB_DEFS"
        :model-value="activeTab"
        :swipe-target="listContentRef"
        @update:model-value="switchTab"
      />

      <div ref="pageListRef" :class="$style.pageList">
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
        <ColumnEmptyState v-else-if="listItems.length === 0" message="ページが見つかりません" :image-url="serverInfoImageUrl" />
        <button
          v-for="item in listItems"
          :key="item.id"
          class="_button"
          :class="$style.pageCard"
          @click="openPage(item.id)"
        >
          <div :class="$style.pageCardTitle">{{ item.title }}</div>
          <div v-if="item.summary" :class="$style.pageCardSummary">{{ item.summary }}</div>
          <div v-if="item.user" :class="$style.pageCardMeta">
            <img v-if="item.user.avatarUrl" :src="item.user.avatarUrl" :class="$style.pageCardAvatar" />
            <span :class="$style.pageCardAuthor">
              <MkMfm v-if="item.user.name" :text="item.user.name" :emojis="(item.user.emojis ?? undefined) as Record<string, string> | undefined" :server-host="account?.host" plain />
              <template v-else>{{ item.user.username }}</template>
            </span>
          </div>
        </button>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use "./column-common.module.scss";

.pageListContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.pageList {
  composes: columnScroller from './column-common.module.scss';
}

.pageCard {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.pageCardTitle {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.pageCardSummary {
  font-size: 0.8em;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pageCardMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  opacity: 0.6;
}

.pageCardAvatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
}

.pageCardAuthor {
  /* placeholder for specificity */
}
</style>
