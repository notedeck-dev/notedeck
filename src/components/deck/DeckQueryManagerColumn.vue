<script setup lang="ts">
import { computed, ref } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { hasScopeTarget, type ScopeTarget } from '@/services/distributable'
import { readOnlyReason } from '@/services/sidecarFileCollection'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  isQueryActive,
  type QueryItem,
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
import DeckDistributableColumn, {
  type EnabledFilterDecl,
  type StoreFeedDecl,
} from './DeckDistributableColumn.vue'
import QueryCard from './QueryCard.vue'

/**
 * クエリ管理カラム (#783 Phase 1.5、仕様追補 E)。殻は `DeckDistributableColumn`
 * (#1202 段階 3)。ここにあるのはクエリ固有の意味だけ: スコープ別プール
 * (#1018)、実行形態 (fast / degraded / invalid)、適用先カラム数、適用中の削除の
 * 確認文、新規作成の雛形
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const queriesStore = useColumnQueriesStore()
const accountsStore = useAccountsStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const { confirm } = useConfirm()
useColumnSetup(() => props.column)

queriesStore.ensureLoaded()

const shell = ref<{ closePicker(): void } | null>(null)

// --- スコープ (per-account / 全アカウント) ---
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
const columnScope = computed<ScopeTarget | null>(() => {
  if (isCrossAccount.value) return { kind: 'global' }
  if (!account.value) return null
  return { kind: 'account', key: accountScopeKey(account.value) }
})

function matchesContext(query: QueryItem): boolean {
  const scope = columnScope.value
  return scope ? hasScopeTarget(query.scope, scope) : false
}

/** カラムのスコープに参加している本体。新しい順 */
const scopedQueries = computed(() =>
  queriesStore.items
    .filter((item) => matchesContext(item))
    .sort((a, b) => b.updatedAt - a.updatedAt),
)

/** このカラムのスコープに未参加のライブラリ本体 (= 追加可能候補)。 */
const libraryCandidates = computed(() =>
  queriesStore.items.filter((q) => !matchesContext(q)),
)

const enabledFilter: EnabledFilterDecl<QueryItem> = {
  get enabledTitle() {
    return i18n.ts._deckQueryManagerColumn.enabledQueries
  },
  get disabledTitle() {
    return i18n.ts._deckQueryManagerColumn.disabledQueries
  },
  isEnabled: isQueryActive,
}

const texts = computed(() => ({
  noMatches: i18n.ts._deckQueryManagerColumn.noMatches,
  empty: i18n.ts._deckQueryManagerColumn.empty,
  noLibrary: i18n.ts._deckQueryManagerColumn.noLibraryCandidates,
}))

const storeFeed = computed<StoreFeedDecl<StoreQueryEntry>>(() => ({
  entries: misStore.queries,
  loading: misStore.queriesLoading,
  error: misStore.queriesError,
  fetch: () => misStore.fetchQueries(),
  refresh: () => misStore.refreshQueries(),
  text: (e) => [e.name, e.description, ...e.tags],
}))

/**
 * クエリの実行形態 (#783)。
 * fast = QIR で高速評価 / degraded = 純粋なので逐次適用へ降格 / invalid = 評価不能
 */
function executionOf(query: QueryItem): 'fast' | 'degraded' | 'invalid' {
  const result = compileColumnQuery(query.content)
  if (result.ok) return 'fast'
  return result.degradable ? 'degraded' : 'invalid'
}

function refCount(query: QueryItem): number {
  return queriesStore.refCountByQueryId[query.id] ?? 0
}

/**
 * クエリを「作る」面は開発者モードに従う (#1034)。導入・実行・削除は一般側。
 * アカウントの見つからないカラムでは作らせない (どのスコープにも属さない個体が
 * できて、作った直後に一覧から消える)
 */
const canEdit = computed(() => isWindowExposed('column-query-editor'))
const canCreate = computed(() => canEdit.value && columnScope.value !== null)

function openEditor(query: QueryItem): void {
  windowsStore.open('column-query-editor', { queryId: query.id })
}

async function createNew(): Promise<void> {
  const query = await queriesStore.add({
    name: i18n.tsx._deckQueryManagerColumn.newQueryName({
      n: queriesStore.items.length + 1,
    }),
    content: `note.text != null && note.text.incl("${i18n.ts._deckQueryManagerColumn.newQueryKeyword}")`,
    // このカラムの文脈で作る = そのスコープに参加した状態で始める
    ...(columnScope.value ? { scope: columnScope.value } : {}),
  })
  openEditor(query)
}

/**
 * カードの「外す」= このカラムのスコープから外す。本体はライブラリに残り、
 * ピッカーから再追加/完全削除できる。可逆なので確認は挟まず undo で戻す。
 */
async function detachFromScope(query: QueryItem): Promise<void> {
  const scope = columnScope.value
  if (!scope) return
  if (!(await queriesStore.unlink(query.id, scope))) {
    useToast().show(readOnlyReason(), 'warning')
    return
  }
  useToast().show(i18n.ts._deckQueryManagerColumn.detached, 'info', {
    action: {
      label: i18n.ts._common.undo,
      onClick: () => void queriesStore.link(query.id, scope),
    },
  })
}

const detachTitle = computed(() =>
  isCrossAccount.value
    ? i18n.ts._deckQueryManagerColumn.detachFromAllAccounts
    : i18n.ts._common.detachFromAccount,
)

async function placeFromLibrary(query: QueryItem): Promise<void> {
  const scope = columnScope.value
  if (!scope) return
  if (!(await queriesStore.link(query.id, scope))) {
    useToast().show(readOnlyReason(), 'warning')
    return
  }
  shell.value?.closePicker()
}

/**
 * 本体の有効/無効 (#1043)。カラムの適用には触れない。読取専用 (ソース欠損) は
 * store が拒否するので理由を出す (可視化と復旧導線は #1111)
 */
async function toggleDisabled(query: QueryItem): Promise<void> {
  const ok = await queriesStore.setEnabled(query.id, !isQueryActive(query))
  if (!ok) useToast().show(readOnlyReason(), 'warning')
}

async function remove(query: QueryItem): Promise<void> {
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
  const undo = await queriesStore.remove(query.id)
  if (undo) {
    useToast().show(i18n.ts._deckQueryManagerColumn.deleted, 'info', {
      action: { label: i18n.ts._common.undo, onClick: undo },
    })
  }
}

// --- ストア ---

function openStoreDetail(entry: StoreQueryEntry): void {
  openSafeUrl(getQueryDetailUrl(entry.id))
}
</script>

<template>
  <DeckDistributableColumn
    ref="shell"
    :column="column"
    :title="i18n.ts._columns.queryManager"
    icon="filter"
    :safe-mode-subject="i18n.ts._deckQueryManagerColumn.safeModeSubject"
    :create-title="i18n.ts._deckQueryManagerColumn.create"
    :can-create="canCreate"
    :items="scopedQueries"
    :search-placeholder="i18n.ts._deckQueryManagerColumn.search"
    :enabled-filter="enabledFilter"
    :library-candidates="libraryCandidates"
    :texts="texts"
    :store="storeFeed"
    @create="createNew"
  >
    <template #installed-empty>
      <div :class="$style.empty">
        <i class="ti ti-filter" :class="$style.emptyIcon" />
        <span>{{ i18n.ts._deckQueryManagerColumn.empty }}</span>
        <span :class="$style.emptyHint">
          {{ i18n.ts._deckQueryManagerColumn.emptyHint }}
        </span>
        <button
          v-if="canCreate"
          class="_button"
          :class="$style.emptyLink"
          @click="createNew"
        >
          {{ i18n.ts._deckQueryManagerColumn.createQuery }}
        </button>
      </div>
    </template>

    <template #card="{ item: query, mode }">
      <QueryCard
        :mode="mode"
        :name="query.name"
        :description="query.description"
        :icon-url="query.iconUrl"
        :store-id="query.store?.id"
        :execution="executionOf(query)"
        :ref-count="refCount(query)"
        :detach-title="detachTitle"
        :disabled="!isQueryActive(query)"
        :read-only="query.readOnly"
        @edit="openEditor(query)"
        @delete="remove(query)"
        @detach="detachFromScope(query)"
        @place="placeFromLibrary(query)"
        @toggle="toggleDisabled(query)"
      />
    </template>

    <template #store-card="{ entry, run }">
      <QueryCard
        mode="store"
        :name="entry.name"
        :description="entry.description"
        :author="entry.author"
        :version="entry.version"
        :icon-url="entry.iconUrl"
        :category-label="queryCategoryLabel(entry.category)"
        :installing="misStore.installingQuery === entry.id"
        :already-installed="misStore.installedIn('query', entry, columnScope ?? undefined)"
        :has-update="misStore.hasQueryUpdate(entry)"
        :updated-at="entry.updatedAt"
        @install="run(() => misStore.installQuery(entry, columnScope ?? undefined))"
        @update="run(() => misStore.updateQuery(entry), i18n.ts._common.updateFailed)"
        @open-detail="openStoreDetail(entry)"
      />
    </template>
  </DeckDistributableColumn>
</template>

<style lang="scss" module>
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
  font-size: var(--nd-font-sm);
  opacity: 0.8;
  line-height: 1.6;
}

.emptyLink {
  margin-top: 4px;
  padding: 6px 14px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
}
</style>
