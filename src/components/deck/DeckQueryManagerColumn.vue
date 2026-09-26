<script setup lang="ts">
import { computed, ref } from 'vue'
import SafeModeNotice from '@/components/common/SafeModeNotice.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useTabSlide } from '@/composables/useTabSlide'
import { i18n } from '@/i18n'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { readOnlyReason } from '@/services/sidecarFileCollection'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  isQueryActive,
  type NamedQueryMeta,
  type QueryScope,
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
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import { isWindowExposed } from '@/windows/exposure'
import ColumnSection from './ColumnSection.vue'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import QueryCard from './QueryCard.vue'

/**
 * クエリ管理カラム (#783 Phase 1.5、仕様追補 E)。
 *
 * テーマ・プラグイン・ウィジェット・スキルと同列のツールカラム。
 * スコープはプラグインと同型 (#1018): 全アカウントのカラムは全体スコープ、
 * per-account カラムはそのアカウントのスコープを管理し、どちらにも属さない
 * 本体はライブラリに残る。
 * 導入済みタブ: 名前付きクエリの一覧・作成・編集・削除と適用先カラム数。
 * ストアタブ: MisStore 配布クエリの検索・導入 (ソースのみ + sha512 検証 +
 * カラムへの自動適用なし。差分承認つき更新は Phase 3.5 で強化)。
 * 本体の有効/無効 (#1043) はプラグインと同型のキルスイッチで、ここで切り替える。
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const queriesStore = useColumnQueriesStore()
const accountsStore = useAccountsStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const { confirm } = useConfirm()
const { columnThemeVars } = useColumnTheme(() => props.column)

queriesStore.ensureLoaded()

// --- Mode resolution (per-account / 全アカウント) ---
const isCrossAccount = computed(() => props.column.accountId == null)
const account = computed(() =>
  isCrossAccount.value
    ? null
    : (accountsStore.accounts.find((a) => a.id === props.column.accountId) ??
      null),
)
/**
 * このカラムが管理するスコープ (#1018)。
 * per-account カラムでアカウントが見つからない (ログアウト済) 場合は null。
 */
const columnScope = computed<QueryScope | null>(() => {
  if (isCrossAccount.value) return { kind: 'global' }
  if (!account.value) return null
  return { kind: 'account', key: accountScopeKey(account.value) }
})

/** カラムのスコープに参加しているか (スコープ別プール)。 */
function matchesContext(query: NamedQueryMeta): boolean {
  const scope = columnScope.value
  if (!scope) return false
  if (scope.kind === 'global') return query.global === true
  return query.installedFor?.includes(scope.key) ?? false
}

type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const scopeCount = computed(
  () => queriesStore.queries.filter((q) => matchesContext(q)).length,
)

const tabDefs = computed<ColumnTabDef[]>(() => [
  {
    value: 'installed',
    label: i18n.tsx._common.installedTab({
      count: scopeCount.value,
    }),
  },
  { value: 'store', label: i18n.ts._common.store },
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

/** プラグイン管理と同じ接頭辞フィルタ (@enabled / @disabled、#1043) */
type FilterMode = 'all' | 'enabled' | 'disabled'
const activeFilter = computed<FilterMode>(() => {
  const q = searchQuery.value.trimStart()
  if (q.startsWith('@enabled')) return 'enabled'
  if (q.startsWith('@disabled')) return 'disabled'
  return 'all'
})
const textQuery = computed(() =>
  searchQuery.value
    .replace(/^@(?:installed|enabled|disabled)\s*/, '')
    .trim()
    .toLowerCase(),
)
function setFilter(mode: FilterMode) {
  searchQuery.value =
    mode === 'enabled' ? '@enabled ' : mode === 'disabled' ? '@disabled ' : ''
}

const visibleQueries = computed(() => {
  const q = textQuery.value
  let sorted = queriesStore.queries
    .filter((item) => matchesContext(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (activeFilter.value === 'enabled') {
    sorted = sorted.filter((item) => isQueryActive(item))
  } else if (activeFilter.value === 'disabled') {
    sorted = sorted.filter((item) => !isQueryActive(item))
  }
  if (!q) return sorted
  return sorted.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  )
})

/** スキルカラムと同じ 3 分類のアコーディオン (ビルドイン/サイドロード/ストア配布) */
interface QuerySection {
  key: string
  label: string
  items: NamedQueryMeta[]
}

const installedSections = computed<QuerySection[]>(() => {
  const sideloaded = visibleQueries.value.filter((q) => !q.storeId)
  const store = visibleQueries.value.filter((q) => !!q.storeId)
  const sections: QuerySection[] = [
    {
      key: 'sideload',
      label: i18n.ts._common.sideload,
      items: sideloaded,
    },
    {
      key: 'store',
      label: i18n.ts._common.storeDistributed,
      items: store,
    },
  ]
  return sections.filter((s) => s.items.length > 0)
})

/**
 * クエリの実行形態 (#783)。
 * fast = QIR で高速評価 / degraded = 純粋なので逐次適用へ降格 / invalid = 評価不能
 */
function executionOf(query: NamedQueryMeta): 'fast' | 'degraded' | 'invalid' {
  const result = compileColumnQuery(query.src)
  if (result.ok) return 'fast'
  return result.degradable ? 'degraded' : 'invalid'
}

function refCount(query: NamedQueryMeta): number {
  return queriesStore.refCountByQueryId[query.id] ?? 0
}

/** クエリを「作る」面は開発者モードに従う (#1034)。導入・実行・削除は一般側 */
const canEdit = computed(() => isWindowExposed('column-query-editor'))

function openEditor(query: NamedQueryMeta): void {
  windowsStore.open('column-query-editor', { queryId: query.id })
}

async function createNew(): Promise<void> {
  const query = await queriesStore.createQuery({
    name: i18n.tsx._deckQueryManagerColumn.newQueryName({
      n: queriesStore.queries.length + 1,
    }),
    src: `note.text != null && note.text.incl("${i18n.ts._deckQueryManagerColumn.newQueryKeyword}")`,
    // このカラムの文脈で作る = そのスコープに参加した状態で始める
    ...(columnScope.value ? { scope: columnScope.value } : {}),
  })
  openEditor(query)
}

/**
 * カードの「外す」= このカラムのスコープから外す。本体はライブラリに残り、
 * ピッカーから再追加/完全削除できる。可逆なので確認は挟まず undo で戻す。
 */
function detachFromScope(query: NamedQueryMeta): void {
  const scope = columnScope.value
  if (!scope) return
  if (!queriesStore.unlinkScope(query.id, scope)) {
    useToast().show(readOnlyReason(), 'warning')
    return
  }
  useToast().show(i18n.ts._deckQueryManagerColumn.detached, 'info', {
    action: {
      label: i18n.ts._common.undo,
      onClick: () => queriesStore.linkScope(query.id, scope),
    },
  })
}

const detachTitle = computed(() =>
  isCrossAccount.value
    ? i18n.ts._deckQueryManagerColumn.detachFromAllAccounts
    : i18n.ts._common.detachFromAccount,
)

// --- Library picker (スコープ未参加のライブラリ本体の追加) ---
const showLibraryPicker = ref(false)

/** このカラムのスコープに未参加のライブラリ本体 (= 追加可能候補)。 */
const libraryCandidates = computed<NamedQueryMeta[]>(() =>
  queriesStore.queries.filter((q) => !matchesContext(q)),
)

function placeFromLibrary(query: NamedQueryMeta): void {
  const scope = columnScope.value
  if (!scope) return
  if (!queriesStore.linkScope(query.id, scope)) {
    useToast().show(readOnlyReason(), 'warning')
    return
  }
  showLibraryPicker.value = false
}

/**
 * 本体の有効/無効 (#1043)。カラムの適用には触れない。読取専用 (ソース欠損) は
 * store が拒否するので理由を出す (可視化と復旧導線は #1111)
 */
async function toggleDisabled(query: NamedQueryMeta): Promise<void> {
  const ok = await queriesStore.setDisabled(query.id, isQueryActive(query))
  if (!ok) useToast().show(readOnlyReason(), 'warning')
}

async function remove(query: NamedQueryMeta): Promise<void> {
  const used = refCount(query)
  // 無効中は今効いていないので、消すとカラムが止まる逆転を先に言う (#1043)
  const usedMessage = isQueryActive(query)
    ? i18n.tsx._deckQueryManagerColumn.deleteConfirmInUse_plural({
        name: query.name,
        count: used,
      })
    : i18n.tsx._deckQueryManagerColumn.deleteConfirmInUseDisabled_plural({
        name: query.name,
        count: used,
      })
  const ok = await confirm({
    title: i18n.ts._deckQueryManagerColumn.deleteTitle,
    message:
      used > 0
        ? usedMessage
        : i18n.tsx._deckQueryManagerColumn.deleteConfirm({ name: query.name }),
    okLabel: i18n.ts._common.delete,
    type: 'danger',
  })
  if (!ok) return
  const undo = await queriesStore.removeQuery(query.id)
  if (undo) {
    useToast().show(i18n.ts._deckQueryManagerColumn.deleted, 'info', {
      action: { label: i18n.ts._common.undo, onClick: undo },
    })
  }
}

// --- Store tab ---

const filteredStoreQueries = computed(() => {
  const q = textQuery.value
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
    // 入れた場所のスコープに参加させる (#1018)
    await misStore.installQuery(entry, columnScope.value ?? undefined)
  } catch (e) {
    installError.value =
      e instanceof Error ? e.message : i18n.ts._common.installFailed
  }
}

async function handleUpdate(entry: StoreQueryEntry): Promise<void> {
  installError.value = null
  try {
    await misStore.updateQuery(entry)
  } catch (e) {
    installError.value =
      e instanceof Error ? e.message : i18n.ts._common.updateFailed
  }
}

function handleOpenStoreDetail(entry: StoreQueryEntry): void {
  openSafeUrl(getQueryDetailUrl(entry.id))
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? i18n.ts._columns.queryManager"
    :theme-vars="columnThemeVars"
  >
    <template #header-icon>
      <i class="ti ti-filter" :class="$style.headerIcon" />
    </template>

    <template #header-meta>
      <button
        v-if="viewTab === 'installed' && canEdit"
        class="_button"
        :class="$style.headerBtn"
        :title="i18n.ts._deckQueryManagerColumn.create"
        @click.stop="createNew"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div ref="columnContentRef" :class="$style.wrapper">
      <SafeModeNotice :subject="i18n.ts._deckQueryManagerColumn.safeModeSubject" />

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
          :placeholder="i18n.ts._deckQueryManagerColumn.search"
        />
        <div v-if="viewTab === 'installed'" :class="$style.searchActions">
          <button
            class="_button"
            :class="[$style.filterBtn, activeFilter === 'enabled' && $style.filterBtnActive]"
            :title="i18n.ts._deckQueryManagerColumn.enabledQueries"
            @click="setFilter(activeFilter === 'enabled' ? 'all' : 'enabled')"
          >
            <i class="ti ti-check" />
          </button>
          <button
            class="_button"
            :class="[$style.filterBtn, activeFilter === 'disabled' && $style.filterBtnActive]"
            :title="i18n.ts._deckQueryManagerColumn.disabledQueries"
            @click="setFilter(activeFilter === 'disabled' ? 'all' : 'disabled')"
          >
            <i class="ti ti-circle-off" />
          </button>
        </div>
      </div>

      <!-- ===== Installed tab ===== -->
      <template v-if="viewTab === 'installed'">
        <div :class="$style.list">
          <div v-if="visibleQueries.length === 0" :class="$style.empty">
            <i class="ti ti-filter" :class="$style.emptyIcon" />
            <span v-if="searchQuery">{{ i18n.ts._deckQueryManagerColumn.noMatches }}</span>
            <template v-else>
              <span>{{ i18n.ts._deckQueryManagerColumn.empty }}</span>
              <span :class="$style.emptyHint">
                {{ i18n.ts._deckQueryManagerColumn.emptyHint }}
              </span>
              <button
                v-if="canEdit"
                class="_button"
                :class="$style.emptyLink"
                @click="createNew"
              >
                {{ i18n.ts._deckQueryManagerColumn.createQuery }}
              </button>
            </template>
          </div>

          <ColumnSection
            v-for="section in installedSections"
            :key="section.key"
            :label="section.label"
            :count="section.items.length"
          >
            <QueryCard
              v-for="query in section.items"
              :key="query.id"
              mode="installed"
              :name="query.name"
              :description="query.description"
              :icon-url="query.iconUrl"
              :store-id="query.storeId"
              :execution="executionOf(query)"
              :ref-count="refCount(query)"
              :detach-title="detachTitle"
              :disabled="!isQueryActive(query)"
              :read-only="query.readOnly"
              @edit="openEditor(query)"
              @delete="remove(query)"
              @detach="detachFromScope(query)"
              @toggle="toggleDisabled(query)"
            />
          </ColumnSection>

          <!-- Library picker: スコープ未参加のライブラリ本体を追加 -->
          <div :class="$style.addArea">
            <button
              :class="[$style.addBtn, showLibraryPicker && $style.addBtnActive]"
              @click="showLibraryPicker = !showLibraryPicker"
            >
              <i :class="showLibraryPicker ? 'ti ti-chevron-up' : 'ti ti-plus'" />
              {{ showLibraryPicker ? i18n.ts._common.close : i18n.ts._common.addFromLibrary }}
            </button>
          </div>

          <div v-if="showLibraryPicker" :class="$style.pickerWrap">
            <div v-if="libraryCandidates.length === 0" :class="$style.pickerEmpty">
              {{ i18n.ts._deckQueryManagerColumn.noLibraryCandidates }}
            </div>
            <QueryCard
              v-for="query in libraryCandidates"
              :key="query.id"
              mode="library"
              :name="query.name"
              :description="query.description"
              :icon-url="query.iconUrl"
              :store-id="query.storeId"
              :execution="executionOf(query)"
              :ref-count="refCount(query)"
              :disabled="!isQueryActive(query)"
              :read-only="query.readOnly"
              @place="placeFromLibrary(query)"
              @edit="openEditor(query)"
              @delete="remove(query)"
              @toggle="toggleDisabled(query)"
            />
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
          {{ i18n.ts._common.loading }}
        </div>

        <div v-else-if="misStore.queriesError" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>{{ i18n.ts._common.storeUnavailable }}</span>
          <button
            class="_button"
            :class="$style.emptyLink"
            @click="misStore.refreshQueries()"
          >
            {{ i18n.ts._common.retry }}
          </button>
        </div>

        <div v-else :class="$style.list">
          <QueryCard
            v-for="entry in filteredStoreQueries"
            :key="entry.id"
            mode="store"
            :name="entry.name"
            :description="entry.description"
            :author="entry.author"
            :version="entry.version"
            :icon-url="entry.iconUrl"
            :category-label="queryCategoryLabel(entry.category)"
            :installing="misStore.installingQuery === entry.id"
            :already-installed="
              misStore.isQueryInstalled(entry, columnScope ?? undefined)
            "
            :has-update="misStore.hasQueryUpdate(entry)"
            :updated-at="entry.updatedAt"
            @install="handleInstall(entry)"
            @update="handleUpdate(entry)"
            @open-detail="handleOpenStoreDetail(entry)"
          />

          <div
            v-if="filteredStoreQueries.length === 0 && !misStore.queriesLoading"
            :class="$style.empty"
          >
            <i class="ti ti-filter" :class="$style.emptyIcon" />
            <span>{{ i18n.ts._deckQueryManagerColumn.noMatches }}</span>
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
.addArea {
  padding: 8px 10px;
}

.addBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: 1px dashed var(--nd-divider);
  background: transparent;
  color: var(--nd-fg);
  opacity: 0.8;
  cursor: pointer;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.addBtnActive {
  opacity: 1;
  background: var(--nd-buttonHoverBg);
}

.pickerWrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px;
}

.pickerEmpty {
  padding: 12px;
  text-align: center;
  font-size: 0.85em;
  opacity: 0.6;
}

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
  display: flex;
  align-items: center;
  padding: 8px 10px 0;
}

.searchActions {
  display: flex;
  align-items: center;
  margin-left: 2px;
  gap: 1px;
}

.filterBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 3px;
  color: var(--nd-fg);
  opacity: 0.45;
  font-size: 13px;
  transition:
    opacity 0.1s,
    background 0.1s;

  &:hover {
    opacity: 0.85;
    background: var(--nd-buttonHoverBg);
  }
}

.filterBtnActive {
  opacity: 1;
  color: var(--nd-accent);
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
  padding: 6px 0;
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
</style>
