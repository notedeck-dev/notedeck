<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAchievementsGrid from '@/components/common/MkAchievementsGrid.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useDeveloperMode } from '@/composables/useDeveloperMode'
import { useServerImages } from '@/composables/useServerImages'
import { useTutorialStore } from '@/composables/useTutorial'
import {
  TUTORIAL_ACHIEVEMENT_BADGES,
  TUTORIAL_ACHIEVEMENT_LABELS,
  tutorialAchievements,
  tutorialAchievementView,
} from '@/services/tutorialAchievements'
import { isExposed } from '@/settings/exposure'
import { getAccountAvatarUrl } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { ACHIEVEMENT_TOTAL, type Achievement } from '@/utils/achievements'
import { AppError } from '@/utils/errors'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)
const isLoggedOut = computed(() => account.value?.hasToken === false)

const achievements = ref<Achievement[]>([])
const loading = ref(false)
const error = ref<AppError | null>(null)

/**
 * サーバー実績 (Misskey) と NoteDeck 独自実績 (#1029) の切替。
 * カラムを増やさず、同じグリッドで出し分ける。
 */
const SOURCE_TABS: ColumnTabDef[] = [
  { value: 'server', label: 'サーバー', icon: 'server' },
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
  if (!props.column.accountId) return
  const acc = account.value
  if (!acc) return
  loading.value = true
  error.value = null

  try {
    const result = unwrap(
      await commands.apiGetUserAchievements(props.column.accountId, acc.userId),
    ) as unknown as Achievement[]
    achievements.value = result
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    loading.value = false
  }
}

fetchAchievements()
void tutorial.loadProgress()

const achievementsScrollRef = useTemplateRef<HTMLElement>(
  'achievementsScrollRef',
)
useColumnPullScroller(achievementsScrollRef)

function scrollToTop() {
  achievementsScrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? '実績'" :theme-vars="columnThemeVars" :pull-refresh="refresh" @refresh="refresh()" @header-click="scrollToTop">
    <template #header-icon>
      <i class="ti ti-medal" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <span v-if="unlockedCount > 0" :class="$style.headerCount">{{ unlockedCount }}/{{ totalCount }}</span>
      <div v-if="account" :class="$style.headerAccount">
        <img :src="proxyThumbUrl(getAccountAvatarUrl(account), 56)" :class="$style.headerAvatar" />
      </div>
    </template>

    <template #header-extra>
      <ColumnTabs
        :tabs="SOURCE_TABS"
        :model-value="source"
        :swipe-target="achievementsScrollRef"
        compact
        @update:model-value="source = $event as 'server' | 'notedeck'"
      />
    </template>

    <div ref="achievementsScrollRef" :class="$style.achievementsScroll">
      <MkAchievementsGrid
        v-if="isOwn"
        :achievements="ownAchievements"
        :types="ownView.types"
        :badges="TUTORIAL_ACHIEVEMENT_BADGES"
        :labels="TUTORIAL_ACHIEVEMENT_LABELS"
        :pending="ownView.pending"
        pending-hint="開発者モードを有効にすると挑戦できます"
        @unlock="setDeveloperMode(true)"
      />
      <div v-else-if="loading && achievements.length === 0 && !isLoggedOut" :class="$style.columnLoading"><LoadingSpinner /></div>
      <ColumnEmptyState
        v-else-if="error && !isLoggedOut"
        :error="error"
        :account-id="column.accountId"
        is-error
        :image-url="serverErrorImageUrl"
        cta-label="再試行"
        cta-icon="ti-refresh"
        @cta="fetchAchievements"
      />
      <ColumnEmptyState v-else-if="achievements.length === 0 && !loading" message="実績がありません" :image-url="serverInfoImageUrl" />
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
