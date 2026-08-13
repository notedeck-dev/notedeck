<script setup lang="ts">
import { computed, ref } from 'vue'
import SafeModeNotice from '@/components/common/SafeModeNotice.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useTabSlide } from '@/composables/useTabSlide'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
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
 * 自動有効化なし。差分承認つき更新は Phase 3.5 で強化)。
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
    label: `インストール済み ${scopeCount.value}`,
  },
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
  const sorted = queriesStore.queries
    .filter((item) => matchesContext(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
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
    { key: 'sideload', label: 'サイドロード', items: sideloaded },
    { key: 'store', label: 'ストア配布', items: store },
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
    name: `新しいクエリ ${queriesStore.queries.length + 1}`,
    src: 'note.text != null && note.text.incl("キーワード")',
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
  queriesStore.unlinkScope(query.id, scope)
  useToast().show('クエリを外しました', 'info', {
    action: {
      label: '元に戻す',
      onClick: () => queriesStore.linkScope(query.id, scope),
    },
  })
}

const detachTitle = computed(() =>
  isCrossAccount.value ? '全アカウント対象から外す' : 'このアカウントから外す',
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
  queriesStore.linkScope(query.id, scope)
  showLibraryPicker.value = false
}

async function remove(query: NamedQueryMeta): Promise<void> {
  const used = refCount(query)
  const ok = await confirm({
    title: 'クエリを削除',
    message:
      used > 0
        ? `「${query.name}」は ${used} 個のカラムで使用中です。削除するとそれらのカラムは評価不能 (fail-closed) になります。削除しますか？`
        : `「${query.name}」を削除しますか？クエリの本文も消えます。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  const undo = await queriesStore.removeQuery(query.id)
  if (undo) {
    useToast().show('クエリを削除しました', 'info', {
      action: { label: '元に戻す', onClick: undo },
    })
  }
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
    // 入れた場所のスコープに参加させる (#1018)
    await misStore.installQuery(entry, columnScope.value ?? undefined)
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'インストール失敗'
  }
}

async function handleUpdate(entry: StoreQueryEntry): Promise<void> {
  installError.value = null
  try {
    await misStore.updateQuery(entry)
  } catch (e) {
    installError.value = e instanceof Error ? e.message : '更新失敗'
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
        v-if="viewTab === 'installed' && canEdit"
        class="_button"
        :class="$style.headerBtn"
        title="新規クエリを作成"
        @click.stop="createNew"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div ref="columnContentRef" :class="$style.wrapper">
      <SafeModeNotice subject="カラムのクエリフィルタ" />

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
              <button
                v-if="canEdit"
                class="_button"
                :class="$style.emptyLink"
                @click="createNew"
              >
                クエリを作成
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
              @edit="openEditor(query)"
              @delete="remove(query)"
              @detach="detachFromScope(query)"
            />
          </ColumnSection>

          <!-- Library picker: スコープ未参加のライブラリ本体を追加 -->
          <div :class="$style.addArea">
            <button
              :class="[$style.addBtn, showLibraryPicker && $style.addBtnActive]"
              @click="showLibraryPicker = !showLibraryPicker"
            >
              <i :class="showLibraryPicker ? 'ti ti-chevron-up' : 'ti ti-plus'" />
              {{ showLibraryPicker ? '閉じる' : 'ライブラリから追加' }}
            </button>
          </div>

          <div v-if="showLibraryPicker" :class="$style.pickerWrap">
            <div v-if="libraryCandidates.length === 0" :class="$style.pickerEmpty">
              ライブラリに追加可能なクエリがありません。
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
              @place="placeFromLibrary(query)"
              @edit="openEditor(query)"
              @delete="remove(query)"
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
            :already-installed="misStore.isQueryInstalled(entry)"
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
            <span>一致するクエリがありません</span>
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
