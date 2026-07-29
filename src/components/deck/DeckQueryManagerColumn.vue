<script setup lang="ts">
import { computed, ref } from 'vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useTabSlide } from '@/composables/useTabSlide'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import {
  type NamedQueryMeta,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getQueryDetailUrl,
  queryCategoryLabel,
  type StoreQueryEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'

/**
 * クエリ管理カラム (#783 Phase 1.5、仕様追補 E)。
 *
 * テーマ・プラグイン・ウィジェット・スキルと同列のツールカラム。
 * 導入済みタブ: 名前付きクエリの一覧・作成・編集・削除と適用先カラム数。
 * ストアタブ: MisStore 配布クエリの検索・導入 (ソースのみ + sha512 検証 +
 * 自動有効化なし。差分承認つき更新は Phase 3.5 で強化)。
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const queriesStore = useColumnQueriesStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const { confirm } = useConfirm()
const { columnThemeVars } = useColumnTheme(() => props.column)

queriesStore.ensureLoaded()

type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const tabDefs = computed<ColumnTabDef[]>(() => [
  { value: 'installed', label: `導入済み ${queriesStore.queries.length}` },
  { value: 'store', label: 'ストア' },
])

function switchTab(tab: string) {
  viewTab.value = tab as ViewTab
  if (tab === 'store') misStore.fetchQueries()
}

const tabIndex = computed(() => viewTabs.indexOf(viewTab.value))
useTabSlide(tabIndex, columnContentRef)

const searchQuery = ref('')
const installError = ref<string | null>(null)

// --- Installed tab ---

const visibleQueries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const sorted = [...queriesStore.queries].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )
  if (!q) return sorted
  return sorted.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  )
})

/** ⚡ = QIR コンパイル可 / ⚠ = 不能 (Phase 2 で逐次適用降格に対応予定) */
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

// --- Store tab ---

const filteredStoreQueries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return misStore.queries
  return misStore.queries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.tags.some((t) => t.toLowerCase().includes(q)),
  )
})

async function handleInstall(entry: StoreQueryEntry): Promise<void> {
  installError.value = null
  try {
    await misStore.installQuery(entry)
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'インストール失敗'
  }
}

function handleOpenStoreDetail(entry: StoreQueryEntry): void {
  openSafeUrl(getQueryDetailUrl(entry.id))
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
        v-if="viewTab === 'installed'"
        class="_button"
        :class="$style.headerBtn"
        title="新規クエリを作成"
        @click.stop="createNew"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div ref="columnContentRef" :class="$style.wrapper">
      <ColumnTabs
        :tabs="tabDefs"
        :model-value="viewTab"
        :swipe-target="columnContentRef"
        @update:model-value="switchTab"
      />

      <div :class="$style.searchWrap">
        <input
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          placeholder="クエリを探す"
        />
      </div>

      <!-- ===== Installed tab ===== -->
      <template v-if="viewTab === 'installed'">
        <div :class="$style.list">
          <div v-if="visibleQueries.length === 0" :class="$style.empty">
            <i class="ti ti-filter" :class="$style.emptyIcon" />
            <span v-if="searchQuery">一致するクエリがありません</span>
            <template v-else>
              <span>名前付きクエリはまだありません</span>
              <span :class="$style.emptyHint">
                クエリはカラムの視界を定義する AiScript 式です。作成すると
                各ノートカラムのクエリ設定からトグルで適用できます。
              </span>
              <button class="_button" :class="$style.emptyLink" @click="createNew">
                クエリを作成
              </button>
            </template>
          </div>

          <div
            v-for="query in visibleQueries"
            :key="query.id"
            :class="$style.card"
            role="button"
            @click="openEditor(query)"
          >
            <div :class="$style.cardHead">
              <i
                :class="[
                  isFast(query) ? 'ti ti-bolt' : 'ti ti-alert-triangle',
                  isFast(query) ? $style.fastIcon : $style.brokenIcon,
                ]"
                :title="isFast(query) ? '高速クエリ (QIR)' : 'コンパイル不能'"
              />
              <span :class="$style.cardName">{{ query.name }}</span>
              <span v-if="query.storeId" :class="$style.storeBadge" title="MisStore 由来">
                <i class="ti ti-building-store" />
              </span>
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
      </template>

      <!-- ===== Store tab ===== -->
      <template v-else>
        <div v-if="installError" :class="$style.storeError">
          <i class="ti ti-alert-circle" />
          {{ installError }}
          <button
            class="_button"
            :class="$style.storeErrorClose"
            @click="installError = null"
          >
            <i class="ti ti-x" />
          </button>
        </div>

        <div v-if="misStore.queriesLoading" :class="$style.empty">
          <i class="ti ti-loader-2 nd-spin" />
          読み込み中...
        </div>

        <div v-else-if="misStore.queriesError" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>ストアに接続できません</span>
          <button
            class="_button"
            :class="$style.emptyLink"
            @click="misStore.refreshQueries()"
          >
            再試行
          </button>
        </div>

        <div v-else :class="$style.list">
          <div
            v-for="entry in filteredStoreQueries"
            :key="entry.id"
            :class="$style.card"
          >
            <div :class="$style.cardHead">
              <span
                v-if="entry.iconUrl"
                :class="$style.storeIcon"
                :style="{ '--icon-url': `url('${entry.iconUrl}')` }"
                aria-hidden="true"
              />
              <i v-else class="ti ti-filter" />
              <span :class="$style.cardName">{{ entry.name }}</span>
              <i
                v-if="misStore.isQueryInstalled(entry)"
                class="ti ti-circle-check-filled"
                :class="$style.installedMark"
                title="導入済み"
              />
              <span :class="$style.version">v{{ entry.version }}</span>
            </div>
            <div :class="$style.cardDesc">{{ entry.description }}</div>
            <div :class="$style.cardFoot">
              <span :class="$style.author">{{ entry.author }}</span>
              <span :class="$style.category">{{ queryCategoryLabel(entry.category) }}</span>
              <span :class="$style.spacer" />
              <button
                class="_button"
                :class="$style.iconBtn"
                title="MisStore で詳細を開く"
                @click.stop="handleOpenStoreDetail(entry)"
              >
                <i class="ti ti-external-link" />
              </button>
              <button
                class="_button"
                :class="$style.installBtn"
                :disabled="misStore.installingQuery === entry.id"
                @click.stop="handleInstall(entry)"
              >
                <i
                  v-if="misStore.installingQuery === entry.id"
                  class="ti ti-loader-2 nd-spin"
                />
                <template v-else>
                  {{ misStore.isQueryInstalled(entry) ? '更新' : 'インストール' }}
                </template>
              </button>
            </div>
          </div>

          <div
            v-if="filteredStoreQueries.length === 0 && !misStore.queriesLoading"
            :class="$style.empty"
          >
            <i class="ti ti-filter" :class="$style.emptyIcon" />
            <span>一致するクエリがありません</span>
          </div>
        </div>
      </template>
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

.wrapper {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.searchWrap {
  padding: 8px 10px 0;
}

.searchInput {
  width: 100%;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--nd-divider, rgba(128, 128, 128, 0.3));
  background: var(--nd-panel);
  color: inherit;
  font: inherit;
  font-size: 0.88em;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
  min-height: 0;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  opacity: 0.75;
  text-align: center;
}

.emptyIcon {
  font-size: 2em;
  opacity: 0.5;
}

.emptyHint {
  font-size: 0.8em;
  opacity: 0.8;
  line-height: 1.6;
}

.emptyLink {
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

.storeBadge {
  opacity: 0.55;
  font-size: 0.85em;
}

.installedMark {
  color: var(--nd-accent);
}

.version {
  font-size: 0.75em;
  opacity: 0.6;
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

.cardFoot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.author {
  font-size: 0.75em;
  opacity: 0.7;
}

.category {
  font-size: 0.7em;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, currentcolor 10%, transparent);
  opacity: 0.8;
}

.spacer {
  flex: 1;
}

.iconBtn {
  padding: 4px 6px;
  border-radius: 6px;
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }
}

.installBtn {
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  font-size: 0.82em;
  font-weight: 600;

  &:disabled {
    opacity: 0.6;
  }
}

.storeIcon {
  width: 18px;
  height: 18px;
  background-color: currentcolor;
  mask: var(--icon-url) no-repeat center / contain;
}

.storeError {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 10px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-error) 15%, transparent);
  color: var(--nd-error);
  font-size: 0.82em;
}

.storeErrorClose {
  margin-left: auto;
  padding: 2px 4px;
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
