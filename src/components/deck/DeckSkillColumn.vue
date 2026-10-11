<script setup lang="ts">
import { computed } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getSkillDetailUrl,
  type StoreSkillEntry,
  skillCategoryLabel,
  useMisStoreStore,
} from '@/stores/misstore'
import {
  generateSkillId,
  isSkillEnabled,
  type SkillItem,
  skillDisplayName,
  useSkillsStore,
} from '@/stores/skills'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import { isWindowExposed } from '@/windows/exposure'
import DeckDistributableColumn, {
  type StoreFeedDecl,
} from './DeckDistributableColumn.vue'
import SkillCard from './SkillCard.vue'

/**
 * スキル管理カラム。殻は `DeckDistributableColumn` (#1202 段階 3)。ここにあるのは
 * スキル固有の意味だけ: 予約 skill (AGENTS / HEARTBEAT) を出さない、mode の並び、
 * HEARTBEAT 対象の切替、mode=always は常時有効。スコープは無いのでピッカーも無い
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const skillsStore = useSkillsStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
useColumnSetup(() => props.column)

skillsStore.ensureLoaded()

/**
 * スキルを「作る」面は開発者モードに従う (#1034)。導入・実行・on/off・削除は
 * 一般側なので、隠れるのは新規作成と編集の入口だけ
 */
const canEdit = computed(() => isWindowExposed('skill-edit'))

// 予約スキル (AGENTS / HEARTBEAT、#1162) は配布物ではなく AI の土台なので、このカラム
// には出さない。編集の入口は AI 設定 (ペルソナの「ルール」/ HEARTBEAT の「巡回の手順」)。
// 並びは always → heartbeat → trigger → manual、同じ mode は名前順
const MODE_ORDER: Record<string, number> = {
  always: 0,
  heartbeat: 1,
  trigger: 2,
  manual: 3,
}
const librarySkills = computed(() =>
  skillsStore.items
    .filter((s) => !s.extra.reserved)
    .sort((a, b) => {
      if (a.extra.mode !== b.extra.mode) {
        return (MODE_ORDER[a.extra.mode] ?? 9) - (MODE_ORDER[b.extra.mode] ?? 9)
      }
      return a.name.localeCompare(b.name)
    }),
)

const texts = computed(() => ({
  noMatches: i18n.ts._deckSkillColumn.noMatches,
  empty: i18n.ts._deckSkillColumn.empty,
  storeEmpty: i18n.ts._deckSkillColumn.storeEmpty,
}))

const storeFeed = computed<StoreFeedDecl<StoreSkillEntry>>(() => ({
  entries: misStore.skills,
  loading: misStore.skillsLoading,
  error: misStore.skillsError,
  fetch: () => misStore.fetchSkills(),
  refresh: () => misStore.refreshSkills(),
}))

function toggleActive(skill: SkillItem) {
  if (skill.extra.mode === 'always') return
  void skillsStore.setActive(skill.id, !skillsStore.isActive(skill.id))
}

/** HEARTBEAT (#411): skill を定期実行対象にするか toggle (mode を切り替え)。 */
function toggleHeartbeat(skill: SkillItem) {
  void skillsStore.setHeartbeat(skill.id, skill.extra.mode !== 'heartbeat')
}

function openInEditor(skill: SkillItem) {
  if (!canEdit.value) return
  windowsStore.open('skill-edit', { skillId: skill.id })
}

async function createNewSkill() {
  const skill = await skillsStore.add({
    id: generateSkillId('skill'),
    name: i18n.ts._deckSkillColumn.newSkillName,
    description: '',
    scope: { kind: 'none' },
    content: `${i18n.ts._deckSkillColumn.newSkillBody}\n`,
    extra: {
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: false,
    },
  })
  windowsStore.open('skill-edit', { skillId: skill.id })
}

const { confirm } = useConfirm()

async function uninstall(skill: SkillItem) {
  const ok = await confirm({
    title: i18n.ts._deckSkillColumn.deleteTitle,
    message: i18n.tsx._deckSkillColumn.deleteConfirm({ name: skill.name }),
    okLabel: i18n.ts._common.delete,
    type: 'danger',
  })
  if (!ok) return
  const undo = await skillsStore.remove(skill.id)
  if (undo) {
    useToast().show(i18n.ts._deckSkillColumn.deleted, 'info', {
      action: { label: i18n.ts._common.undo, onClick: undo },
    })
  }
}

function openStoreDetail(entry: StoreSkillEntry) {
  openSafeUrl(getSkillDetailUrl(entry.id))
}
</script>

<template>
  <DeckDistributableColumn
    :column="column"
    :title="i18n.ts._columns.skill"
    icon="sparkles"
    :create-title="i18n.ts._deckSkillColumn.create"
    :can-create="canEdit"
    :items="librarySkills"
    :search-placeholder="i18n.ts._deckSkillColumn.search"
    :search-text="(s) => [skillDisplayName(s), s.description]"
    :texts="texts"
    :store="storeFeed"
    @create="createNewSkill"
  >
    <template #card="{ item: skill }">
      <SkillCard
        mode="installed"
        :name="skillDisplayName(skill)"
        :description="skill.description"
        :author="skill.extra.author"
        :version="skill.extra.version"
        :icon-url="skill.iconUrl"
        :skill-mode="skill.extra.mode"
        :active="isSkillEnabled(skill)"
        :can-edit="canEdit"
        @edit="openInEditor(skill)"
        @toggle="toggleActive(skill)"
        @heartbeat="toggleHeartbeat(skill)"
        @delete="uninstall(skill)"
      />
    </template>

    <template #store-card="{ entry, run }">
      <SkillCard
        mode="store"
        :name="entry.name"
        :description="entry.description"
        :author="entry.author"
        :version="entry.version"
        :icon-url="entry.iconUrl"
        :category-label="skillCategoryLabel(entry.category)"
        :installing="misStore.installingSkill === entry.id"
        :already-installed="misStore.installedIn('skill', entry)"
        :has-update="misStore.hasSkillUpdate(entry)"
        :updated-at="entry.updatedAt"
        @install="run(() => misStore.installSkill(entry))"
        @update="run(() => misStore.updateSkill(entry), i18n.ts._common.updateFailed)"
        @open-detail="openStoreDetail(entry)"
      />
    </template>
  </DeckDistributableColumn>
</template>
