<script setup lang="ts">
import { computed } from 'vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import {
  type NamedQueryMeta,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useWindowsStore } from '@/stores/windows'
import DeckColumn from './DeckColumn.vue'

/**
 * クエリ管理カラム (#783 Phase 1.5、仕様追補 E)。
 *
 * テーマ・プラグイン・ウィジェット・スキルと同列のツールカラム。
 * 名前付きクエリの一覧・作成・編集・削除と適用先カラム数の確認。
 * MisStore タブ (導入 → 差分承認 → 更新) は Phase 3.5 で追加する。
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const queriesStore = useColumnQueriesStore()
const windowsStore = useWindowsStore()
const { confirm } = useConfirm()
const { columnThemeVars } = useColumnTheme(() => props.column)

queriesStore.ensureLoaded()

const items = computed(() =>
  [...queriesStore.queries].sort((a, b) => b.updatedAt - a.updatedAt),
)

/** ⚡ = QIR コンパイル可 / ⚠ = 不能 (保存時に弾かれるため通常は発生しない) */
function isFast(query: NamedQueryMeta): boolean {
  return compileColumnQuery(query.src).ok
}

function refCount(query: NamedQueryMeta): number {
  return queriesStore.refCountByQueryId[query.id] ?? 0
}

function openEditor(query: NamedQueryMeta): void {
  windowsStore.open('column-query-editor', { queryId: query.id })
}

async function createNew(): Promise<void> {
  const query = await queriesStore.createQuery({
    name: `新しいクエリ ${queriesStore.queries.length + 1}`,
    src: 'note.text != null && note.text.incl("キーワード")',
  })
  openEditor(query)
}

async function remove(query: NamedQueryMeta): Promise<void> {
  const used = refCount(query)
  const ok = await confirm({
    title: 'クエリを削除',
    message:
      used > 0
        ? `「${query.name}」は ${used} 個のカラムで使用中です。削除するとそれらのカラムは評価不能 (fail-closed) になります。削除しますか？`
        : `「${query.name}」を削除しますか？`,
    type: 'danger',
  })
  if (!ok) return
  await queriesStore.removeQuery(query.id)
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'クエリ'"
    :theme-vars="columnThemeVars"
  >
    <template #header-icon>
      <i class="ti ti-filter" :class="$style.headerIcon" />
    </template>

    <template #header-meta>
      <button
        class="_button"
        :class="$style.headerBtn"
        title="新規クエリを作成"
        @click.stop="createNew"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div :class="$style.body">
      <div v-if="items.length === 0" :class="$style.empty">
        <i class="ti ti-filter" />
        <p>名前付きクエリはまだありません</p>
        <p :class="$style.emptyHint">
          クエリはカラムの視界を定義する AiScript 式です。作成すると
          各ノートカラムのクエリ設定からトグルで適用できます。
        </p>
        <button class="_button" :class="$style.createBtn" @click="createNew">
          <i class="ti ti-plus" />クエリを作成
        </button>
      </div>

      <div
        v-for="query in items"
        :key="query.id"
        :class="$style.card"
        class="_button"
        role="button"
        @click="openEditor(query)"
      >
        <div :class="$style.cardHead">
          <i
            :class="[
              isFast(query) ? 'ti ti-bolt' : 'ti ti-alert-triangle',
              isFast(query) ? $style.fastIcon : $style.brokenIcon,
            ]"
          />
          <span :class="$style.cardName">{{ query.name }}</span>
          <span v-if="refCount(query) > 0" :class="$style.refCount">
            {{ refCount(query) }} カラム
          </span>
        </div>
        <div v-if="query.description" :class="$style.cardDesc">
          {{ query.description }}
        </div>
        <code :class="$style.cardSrc">{{ query.src }}</code>
        <div :class="$style.cardActions">
          <button
            class="_button"
            :class="$style.deleteBtn"
            title="削除"
            @click.stop="remove(query)"
          >
            <i class="ti ti-trash" />
          </button>
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
.headerIcon {
  opacity: 0.85;
}

.headerBtn {
  padding: 4px 8px;
  border-radius: 6px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  opacity: 0.75;
  text-align: center;

  i {
    font-size: 2em;
    opacity: 0.5;
  }

  p {
    margin: 0;
  }
}

.emptyHint {
  font-size: 0.8em;
  opacity: 0.8;
  line-height: 1.6;
}

.createBtn {
  margin-top: 4px;
  padding: 6px 14px;
  border-radius: 6px;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--nd-panel);
  text-align: left;
  cursor: pointer;
}

.cardHead {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fastIcon {
  color: var(--nd-accent);
}

.brokenIcon {
  color: var(--nd-error);
}

.cardName {
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refCount {
  font-size: 0.72em;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  white-space: nowrap;
}

.cardDesc {
  font-size: 0.8em;
  opacity: 0.75;
}

.cardSrc {
  font-size: 0.72em;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.cardActions {
  position: absolute;
  top: 8px;
  right: 8px;
}

.deleteBtn {
  padding: 4px 6px;
  border-radius: 6px;
  opacity: 0.5;

  &:hover {
    opacity: 1;
    color: var(--nd-error);
  }
}
</style>
