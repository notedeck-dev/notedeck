<script setup lang="ts">
import { computed, ref } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAchievementsGrid from '@/components/common/MkAchievementsGrid.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useDeveloperMode } from '@/composables/useDeveloperMode'
import { useTutorialStore } from '@/composables/useTutorial'
import { i18n } from '@/i18n'
import { ACHIEVEMENT_TOTAL, type Achievement } from '@/services/achievements'
import {
  TUTORIAL_ACHIEVEMENT_BADGES,
  TUTORIAL_ACHIEVEMENT_LABELS,
  tutorialAchievements,
  tutorialAchievementView,
} from '@/services/tutorialAchievements'
import { isExposed } from '@/settings/exposure'
import { getAccountAvatarUrl } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'

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

const achievements = ref<Achievement[]>([])

/**
 * サーバー実績 (Misskey) と NoteDeck 独自実績 (#1029) の切替。
 * カラムを増やさず、同じグリッドで出し分ける。
 */
const SOURCE_TABS: ColumnTabDef[] = [
  {
    value: 'server',
    get label() {
      return i18n.ts._common.server
    },
    icon: 'server',
  },
  { value: 'notedeck', label: 'NoteDeck', icon: 'checkbox' },
]
// ログイン前はサーバー実績を取れないので、見られる方を既定にする
const source = ref<'server' | 'notedeck'>(
  account.value?.hasToken === false || !props.column.accountId
    ? 'notedeck'
    : 'server',
)

const tutorial = useTutorialStore()
const ownAchievements = computed(() => tutorialAchievements(tutorial.progress))

/**
 * 開発者モードで開放されるカテゴリは達成できないので、分母から外して
 * 鍵として見せる (#1036)。解除済みのものは隠れる側に回っても達成済みのまま
 */
const ownView = computed(() =>
  tutorialAchievementView(tutorial.progress, (category) =>
    isExposed(category.exposure),
  ),
)

const { setEnabled: setDeveloperMode } = useDeveloperMode()

const isOwn = computed(() => source.value === 'notedeck')
const shownAchievements = computed(() =>
  isOwn.value ? ownAchievements.value : achievements.value,
)
const unlockedCount = computed(() => shownAchievements.value.length)
const totalCount = computed(() =>
  isOwn.value ? ownView.value.total : ACHIEVEMENT_TOTAL,
)

/** 引いて更新。NoteDeck タブは達成記録を読み直す (サーバーは叩かない) */
async function refresh() {
  if (isOwn.value) {
    await tutorial.loadProgress()
    return
  }
  await fetchAchievements()
}

async function fetchAchievements() {
  const accountId = props.column.accountId
  const acc = account.value
  if (!accountId || !acc) return
  await withLoading(async () => {
    achievements.value = unwrap(
      await commands.apiGetUserAchievements(accountId, acc.userId),
    ) as unknown as Achievement[]
  })
}

fetchAchievements()
void tutorial.loadProgress()
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? i18n.ts._columns.achievements" :theme-vars="columnThemeVars" :pull-refresh="refresh" @refresh="refresh()" @header-click="scrollToTop">
    <template #header-icon>
      <i class="ti ti-medal" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <span v-if="unlockedCount > 0" :class="$style.headerCount">{{ unlockedCount }}/{{ totalCount }}</span>
    </template>

    <template #header-extra>
      <ColumnTabs
        :tabs="SOURCE_TABS"
        :model-value="source"
        :swipe-target="scroller"
        compact
        @update:model-value="source = $event as 'server' | 'notedeck'"
      />
    </template>

    <div ref="scroller" :class="$style.achievementsScroll">
      <MkAchievementsGrid
        v-if="isOwn"
        :achievements="ownAchievements"
        :types="ownView.types"
        :badges="TUTORIAL_ACHIEVEMENT_BADGES"
        :labels="TUTORIAL_ACHIEVEMENT_LABELS"
        :pending="ownView.pending"
        :pending-hint="i18n.ts._deckAchievementsColumn.pendingHint"
        @unlock="setDeveloperMode(true)"
      />
      <div v-else-if="isLoading && achievements.length === 0 && !isLoggedOut" :class="$style.columnLoading"><LoadingSpinner /></div>
      <ColumnEmptyState
        v-else-if="error && !isLoggedOut"
        :error="error"
        :account-id="column.accountId"
        is-error
        :image-url="serverErrorImageUrl"
        :cta-label="i18n.ts._common.retry"
        cta-icon="ti-refresh"
        @cta="fetchAchievements"
      />
      <ColumnEmptyState v-else-if="achievements.length === 0 && !isLoading" :message="i18n.ts._deckAchievementsColumn.empty" :image-url="serverInfoImageUrl" />
      <MkAchievementsGrid v-else :achievements="achievements" />
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.headerCount {
  font-size: 0.75em;
  opacity: 0.6;
  margin-right: 4px;
}

.achievementsScroll {
  composes: columnScroller from './column-common.module.scss';
  position: relative;
}
</style>
