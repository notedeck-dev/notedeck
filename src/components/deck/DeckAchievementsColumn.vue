<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAchievementsGrid from '@/components/common/MkAchievementsGrid.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useTutorialStore } from '@/composables/useTutorial'
import {
  TUTORIAL_ACHIEVEMENT_BADGES,
  TUTORIAL_ACHIEVEMENT_LABELS,
  TUTORIAL_ACHIEVEMENT_TOTAL,
  TUTORIAL_ACHIEVEMENT_TYPES,
  tutorialAchievements,
} from '@/services/tutorialAchievements'
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
const source = ref<'server' | 'notedeck'>('server')

const tutorial = useTutorialStore()
const ownAchievements = computed(() => tutorialAchievements(tutorial.progress))

const isOwn = computed(() => source.value === 'notedeck')
const shownAchievements = computed(() =>
  isOwn.value ? ownAchievements.value : achievements.value,
)
const unlockedCount = computed(() => shownAchievements.value.length)
const totalCount = computed(() =>
  isOwn.value ? TUTORIAL_ACHIEVEMENT_TOTAL : ACHIEVEMENT_TOTAL,
)

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
  <DeckColumn :column-id="column.id" :title="column.name ?? '実績'" :theme-vars="columnThemeVars" :pull-refresh="fetchAchievements" @refresh="fetchAchievements()" @header-click="scrollToTop">
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
      <ColumnTabs :tabs="SOURCE_TABS" :model-value="source" compact @update:model-value="source = $event as 'server' | 'notedeck'" />
    </template>

    <div ref="achievementsScrollRef" :class="$style.achievementsScroll">
      <MkAchievementsGrid
        v-if="isOwn"
        :achievements="ownAchievements"
        :types="TUTORIAL_ACHIEVEMENT_TYPES"
        :badges="TUTORIAL_ACHIEVEMENT_BADGES"
        :labels="TUTORIAL_ACHIEVEMENT_LABELS"
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
