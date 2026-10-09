<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppTime from '@/components/common/AppTime.vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { proxyUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'

interface Announcement {
  id: string
  createdAt: string
  updatedAt: string | null
  title: string
  text: string
  imageUrl: string | null
  icon: 'info' | 'warning' | 'error' | 'success'
  display: 'dialog' | 'normal' | 'banner'
  needConfirmationToRead: boolean
  silence: boolean
  forYou: boolean
  isRead: boolean
}

const props = defineProps<{
  column: DeckColumnType
}>()

const {
  account,
  columnThemeVars,
  serverInfoImageUrl,
  serverErrorImageUrl,
  isLoggedOut,
  isLoading,
  error,
  withLoading,
  scroller,
  scrollToTop,
} = useColumnSetup(() => props.column)
useColumnPullScroller(scroller)

const announcements = ref<Announcement[]>([])

const ICON_MAP: Record<string, string> = {
  info: 'info-circle',
  warning: 'alert-triangle',
  error: 'circle-x',
  success: 'circle-check',
}

const ICON_COLOR_MAP: Record<string, string> = {
  info: 'var(--nd-accent)',
  warning: 'var(--nd-warn, #e8a530)',
  error: 'var(--nd-love)',
  success: 'var(--nd-renote, #36d298)',
}

async function fetchAnnouncements() {
  const acc = account.value
  if (!acc) return
  await withLoading(async () => {
    announcements.value = unwrap(
      await commands.apiGetAnnouncements(acc.id, 20, true),
    ) as unknown as Announcement[]
  })
}

async function markAsRead(announcement: Announcement) {
  if (announcement.isRead) return
  const acc = account.value
  if (!acc) return

  try {
    unwrap(await commands.apiReadAnnouncement(acc.id, announcement.id))
    announcement.isRead = true
    announcements.value = [...announcements.value]
  } catch {
    // non-critical
  }
}

onMounted(() => {
  fetchAnnouncements()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="i18n.ts._columns.announcements"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="fetchAnnouncements"
    @refresh="fetchAnnouncements"
  >
    <template #header-icon>
      <i class="ti ti-speakerphone" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
    </template>

    <ColumnEmptyState
      v-if="error && !isLoggedOut"
      :error="error"
      :account-id="column.accountId"
      :image-url="serverErrorImageUrl"
      is-error
      :cta-label="i18n.ts._common.retry"
      cta-icon="ti-refresh"
      @cta="fetchAnnouncements"
    />

    <div v-else :class="$style.announcementsBody">
      <ColumnEmptyState
        v-if="announcements.length === 0 && !isLoading"
        :message="i18n.ts._deckAnnouncementsColumn.empty"
        :image-url="serverInfoImageUrl"
      />

      <div v-else ref="scroller" :class="$style.announcementsScroller">
        <div
          v-for="item in announcements"
          :key="item.id"
          :class="[$style.announcementItem, { [$style.unread]: !item.isRead }]"
        >
          <div :class="$style.announcementHeader">
            <i
              :class="`ti ti-${ICON_MAP[item.icon] || 'info-circle'}`"
              :style="{ color: ICON_COLOR_MAP[item.icon] || 'var(--nd-accent)' }"
            />
            <span :class="$style.announcementTitle">{{ item.title }}</span>
            <AppTime :class="$style.announcementTime" :at="item.createdAt" />
          </div>

          <div v-if="item.imageUrl" :class="$style.announcementImage">
            <img :src="proxyUrl(item.imageUrl)" loading="lazy" />
          </div>

          <div :class="$style.announcementText">
            <MkMfm :text="item.text" :server-host="account?.host" />
          </div>

          <div v-if="!item.isRead" :class="$style.announcementActions">
            <button class="_button" :class="$style.announcementReadBtn" @click="markAsRead(item)">
              <i class="ti ti-check" /> {{ i18n.ts._deckAnnouncementsColumn.markAsRead }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';
.announcementsBody {
  composes: tlBody from './column-common.module.scss';
}

.announcementsScroller {
  composes: columnScroller from './column-common.module.scss';
}

.announcementItem {
  padding: 16px;
  border-bottom: 1px solid var(--nd-divider);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;

  &.unread {
    background: var(--nd-accentedBg);
  }
}

.announcementHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.announcementTitle {
  flex: 1;
  min-width: 0;
  font-weight: var(--nd-weight-bold);
  font-size: var(--nd-font-body);
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcementTime {
  flex-shrink: 0;
  font-size: var(--nd-font-sm);
  opacity: 0.5;
}

.announcementImage {
  margin-bottom: 8px;

  img {
    max-width: 100%;
    border-radius: var(--nd-radius-md);
  }
}

.announcementText {
  font-size: var(--nd-font-body);
  line-height: 1.6;
  color: var(--nd-fg);
  word-break: break-word;
}

.announcementActions {
  margin-top: 10px;
}

.announcementReadBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  font-size: var(--nd-font-md);
  font-weight: var(--nd-weight-bold);
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: #fff;
  cursor: pointer;
  transition: filter var(--nd-duration-base);

  &:hover {
    filter: brightness(1.1);
  }
}
</style>
