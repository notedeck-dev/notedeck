<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type {
  NormalizedNote,
  TimelineFilter,
  TimelineType,
} from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import CrossAccountProgress from '@/components/common/CrossAccountProgress.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAd from '@/components/common/MkAd.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useAds } from '@/composables/useAds'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useCrossAccountNotes } from '@/composables/useCrossAccountNotes'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { provideNoteFrame } from '@/composables/useNoteFrame'
import type { NoteScrollerExpose } from '@/composables/useNoteScrollerRef'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { useTabSlide } from '@/composables/useTabSlide'
import { i18n } from '@/i18n'
import type { VariantKey } from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { accountsCacheKeyDeps, columnCacheKey } from '@/utils/columnCacheKey'
import type { CustomTimelineInfo } from '@/utils/customTimelines'
import {
  clearAvailableTlCache,
  clearRuntimeDenied,
  commonFilterKeys,
  detectAvailableTimelines,
  detectCustomTimelines,
  detectFilterKeys,
  findModeKeyForTimeline,
  getRelatedTimelineTypes,
  markTimelineDenied,
} from '@/utils/customTimelines'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { matchesFilter } from '@/utils/timelineFilter'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import ColumnFilterButton from './ColumnFilterButton.vue'
import ColumnPullFrame from './ColumnPullFrame.vue'
import ColumnQueryBadge from './ColumnQueryBadge.vue'
import ColumnQueryBanners from './ColumnQueryBanners.vue'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const accountsStore = useAccountsStore()
const cacheKeyDeps = accountsCacheKeyDeps()

const isCrossAccount = computed(() => props.column.accountId == null)
// 全アカウント面ではノートの基準サーバーを絶対にする (#1059)
provideNoteFrame(isCrossAccount)

// Guest accounts can only access public timelines (local/global), not home/social
const accountData = accountsStore.accountMap.get(props.column.accountId ?? '')
const isGuestAccountForTl = accountData?.hasToken === false
const defaultTl: TimelineType = isGuestAccountForTl ? 'local' : 'home'
const savedTl = props.column.tl
const initialTl: TimelineType =
  isGuestAccountForTl && (savedTl === 'home' || savedTl === 'social')
    ? defaultTl
    : savedTl || defaultTl
const tlType = ref<TimelineType>(initialTl)
// guest の TL 強制変換 (home/social → local、未設定 → local) はメモリ上だけ
// でなく永続化する。静的キー導出 (columnCacheKey) と getKey の恒久不一致を
// 防ぐ (notecli#30 v5 §6-13)
if (isGuestAccountForTl && savedTl !== initialTl) {
  deckStore.updateColumn(props.column.id, { tl: initialTl })
}

// --- Filter ---
const columnFilters = computed<TimelineFilter>(() => props.column.filters ?? {})

function buildTimelineOptions() {
  const filters = columnFilters.value
  const hasFilters = Object.keys(filters).length > 0
  return {
    ...(hasFilters ? { filters } : {}),
  }
}

// --- Connect readiness: wait for policy detection before connecting ---
const connectReady = ref(false)

// --- NoteColumnConfig ---

const noteColumnConfig: NoteColumnConfig = {
  connectReady,
  getColumn: () => props.column,
  fetch: async (adapter, opts) => {
    try {
      return await adapter.api.getTimeline(tlType.value, {
        ...opts,
        ...buildTimelineOptions(),
      })
    } catch (e) {
      // Promote server errors that mean "this tab is unreachable" into
      // runtime-denied state. Server error codes (LTL_DISABLED, GTL_DISABLED,
      // CREDENTIAL_REQUIRED) arrive structured; the legacy "disabled" substring
      // is still honored for servers that only put it in the message.
      const err = AppError.from(e)
      const apiCode = err.displayCode
      const credentialRequired = apiCode === 'CREDENTIAL_REQUIRED'
      const explicitTarget: TimelineType | null =
        apiCode === 'LTL_DISABLED'
          ? 'local'
          : apiCode === 'GTL_DISABLED'
            ? 'global'
            : null
      const isUnreachable =
        explicitTarget !== null ||
        credentialRequired ||
        err.message.includes('disabled')
      if (isUnreachable) {
        const target = explicitTarget ?? tlType.value
        const aid = props.column.accountId
        // CREDENTIAL_REQUIRED only kills the failing tab; *_DISABLED takes the
        // whole policy group (e.g. local + social share ltlAvailable).
        const related = credentialRequired
          ? new Set<string>([target])
          : new Set(getRelatedTimelineTypes(target))
        if (aid) {
          for (const t of related) markTimelineDenied(aid, t)
        }
        availableStandardTl.value = availableStandardTl.value.filter(
          (t) => !related.has(t),
        )
        if (related.has(tlType.value)) {
          switchTl(availableStandardTl.value[0] ?? 'home')
        }
        return []
      }
      throw e
    }
  },
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
  },
  // フィルタ違いのカラム間で dedup レスポンスを共有しない (#651)
  fetchKey: () => JSON.stringify(columnFilters.value),
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      return createQuerySubscription({
        open: async () =>
          unwrap(
            await commands.querySubscribeTimeline(
              accountId,
              tlType.value,
              null,
            ),
          ),
        onInsert: (item) => {
          // 組込フィルタ・可視性防御は useNoteColumn の enqueue 前段が担う (#841)
          const note = queryItemAsNote(item)
          if (note) enqueue(note)
        },
        onDelete: (id) =>
          callbacks.onNoteUpdated?.({
            accountId,
            noteId: id,
            type: 'deleted',
            body: {},
          }),
        onUpdate: (event) => callbacks.onNoteUpdated?.(event),
      })
    },
  },
  // 組込フィルタ + local/global の public 限定 (可視性防御) は
  // useNoteColumn 側で matchesFilter に一元適用される (#841)
  timelineType: () => tlType.value,
}

// --- TL type definitions ---
const TL_TYPES: { value: TimelineType; label: string }[] = [
  {
    value: 'home',
    get label() {
      return i18n.ts._deckTimelineColumn.home
    },
  },
  {
    value: 'local',
    get label() {
      return i18n.ts._deckTimelineColumn.local
    },
  },
  {
    value: 'social',
    get label() {
      return i18n.ts._deckTimelineColumn.social
    },
  },
  {
    value: 'global',
    get label() {
      return i18n.ts._deckTimelineColumn.global
    },
  },
]

const TL_ICONS: Record<TimelineType, string> = {
  home: 'home',
  local: 'planet',
  social: 'rocket',
  global: 'whirl',
}

// --- 全アカウントモード (#1059) ---
// 対象はホームとグローバルだけ。ホームは「自分がフォローしている人」、グローバルは
// 「各サーバーから見た連合全体」なのでサーバーを跨いでも意味が通り、同じ連合
// ノートが複数サーバーから届くので束ね (#1058) の効果も出る。ローカルと、
// ローカルを含むソーシャルは「そのサーバーの民」の性質が強く対象にしない
// (#205 の棄却理由がそのまま残る)
const CROSS_TL_TYPES = TL_TYPES.filter(
  (t) => t.value === 'home' || t.value === 'global',
)
if (
  isCrossAccount.value &&
  !CROSS_TL_TYPES.some((t) => t.value === tlType.value)
) {
  tlType.value = 'home'
  deckStore.updateColumn(props.column.id, { tl: 'home' })
}
const crossTabDefs = computed<ColumnTabDef[]>(() =>
  CROSS_TL_TYPES.map((opt) => ({
    value: opt.value,
    label: opt.label,
    icon: TL_ICONS[opt.value],
    iconIsSvg: false,
  })),
)

const {
  columnThemeVars: crossThemeVars,
  serverInfoImageUrl,
  serverErrorImageUrl,
  isLoading,
  error,
  handlers,
  postForm,
  scroller,
  onScrollReport,
} = useColumnSetup(() => props.column)

const {
  notes: crossNotes,
  groups,
  noteScrollerRef,
  scrollToTop,
  connectCrossAccount,
  loadMoreCrossAccount,
  handleScroll,
  removeNote,
  pendingCount,
  animatingRowKeys,
  crossProgress,
  isPulling: crossIsPulling,
  isPulledEnough: crossIsPulledEnough,
  isRefreshing: crossIsRefreshing,
  displayHeight: crossPullHeight,
  columnQueryState: crossQueryState,
  columnQueryErrorCount: crossQueryErrorCount,
  columnQueryExcludedCount: crossQueryExcludedCount,
  columnQuerySuspendedKeys: crossQuerySuspendedKeys,
  columnQuerySuspendedCount: crossQuerySuspendedCount,
  columnQueryMissingIds: crossQueryMissingIds,
  resumeSuspendedQueries: crossResumeSuspendedQueries,
  dropMissingQueryRefs: crossDropMissingQueryRefs,
} = useCrossAccountNotes({
  // 組込フィルタは API 側パラメータ (per-account と同じ) + クライアント側の
  // 防御層、クエリは共有の評価器で、全アカウント面でも効かせる
  fetchNotes: (adapter, opts) =>
    adapter.api.getTimeline(tlType.value, {
      ...opts,
      ...buildTimelineOptions(),
    }),
  isCrossAccount: () => isCrossAccount.value,
  filter: {
    getColumn: () => props.column,
    builtinAdmits: (n) => matchesFilter(n, props.column.filters, tlType.value),
  },
  // per-account と同じ 'home' / 'social' キーで各アカウントのキャッシュを読む
  cacheKey: () => columnCacheKey(props.column, cacheKeyDeps),
  isLoading,
  error,
  scroller,
  onScrollReport,
  deleteNote: handlers.delete,
  streaming: {
    columnId: props.column.id,
    subscribe: (accountId, _adapter, enqueue, callbacks) =>
      createQuerySubscription({
        open: async () =>
          unwrap(
            await commands.querySubscribeTimeline(
              accountId,
              tlType.value,
              null,
            ),
          ),
        onInsert: (item) => {
          const note = queryItemAsNote(item)
          if (note) enqueue(note)
        },
        onDelete: (id) =>
          callbacks.onNoteUpdated({
            accountId,
            noteId: id,
            type: 'deleted',
            body: {},
          }),
        onUpdate: (event) => callbacks.onNoteUpdated(event),
      }),
  },
})

// --- DeckNoteColumn ref (expose: account, scroller, reconnect, switchWithSnapshot, notes, columnThemeVars) ---
const noteColumnRef = ref<InstanceType<typeof DeckNoteColumn> | null>(null)

// Report visible items to deckStore so AI / inspector / audit log can read them
// without special-casing AI columns (memory feedback_no_special_case_columns).
watch(
  () =>
    isCrossAccount.value
      ? crossNotes.value
      : (noteColumnRef.value?.notes as NormalizedNote[] | undefined),
  (notes) => {
    deckStore.reportVisibleItems(props.column.id, notes ?? [])
  },
  { immediate: true },
)
const account = computed(() => noteColumnRef.value?.account)
const columnThemeVars = computed(() =>
  isCrossAccount.value
    ? crossThemeVars.value
    : (noteColumnRef.value?.columnThemeVars ?? {}),
)
const swipeTarget = computed<HTMLElement | null>(() =>
  isCrossAccount.value
    ? scroller.value
    : ((noteColumnRef.value?.scroller as HTMLElement | undefined) ?? null),
)

async function reconnect(useCache = false) {
  await noteColumnRef.value?.reconnect(useCache)
}

// --- Ads ---
const { fetchAds, pickAd, shouldShowAd, muteAd, serverHost } = useAds(
  () => props.column.accountId ?? undefined,
)

function isTablerIcon(icon: string): boolean {
  return !icon.includes(' ')
}

const currentTlIcon = computed(
  () => TL_ICONS[tlType.value] ?? customTlIcon.value ?? 'home',
)

// --- Custom timelines ---
const customTimelines = ref<CustomTimelineInfo[]>([])
const availableStandardTl = ref<string[]>([])
const customTlIcon = computed(() => {
  const ct = customTimelines.value.find((t) => t.type === tlType.value)
  return ct?.icon
})

// --- Mode state (per-account, per-TL) ---
const tlModes = ref<Record<string, boolean>>({})
const policyLoaded = ref(false)

const allTlTypes = computed(() => {
  if (!connectReady.value) return [] // Policy detection not yet complete
  if (!policyLoaded.value) return TL_TYPES.map((t) => t) // No account — show all
  const allowed = availableStandardTl.value
  if (allowed.length === 0) {
    // Policies loaded but nothing available. Guests have no home/social, so
    // returning empty is the only honest answer; authenticated users fall
    // back to home as a last resort.
    if (isGuestAccountForTl) return []
    return TL_TYPES.filter((t) => t.value === 'home')
  }
  const allowedSet = new Set(allowed)
  const standard = TL_TYPES.filter((t) => allowedSet.has(t.value))
  for (const ct of customTimelines.value) {
    if (allowedSet.has(ct.type)) {
      standard.push({ value: ct.type, label: ct.label })
    }
  }
  return standard
})

// Tab slide animation
const tlTabIndex = computed(() => {
  const types = isCrossAccount.value ? CROSS_TL_TYPES : allTlTypes.value
  return types.findIndex((t) => t.value === tlType.value)
})
useTabSlide(tlTabIndex, swipeTarget)

function getTlIcon(type: string): string {
  if (TL_ICONS[type]) return TL_ICONS[type]
  const ct = customTimelines.value.find((t) => t.type === type)
  return ct?.icon ?? TL_ICONS.home ?? ''
}

// --- Filter keys (組込トグルの出し分け) ---
// メニュー UI 本体は DeckNoteColumn に共通実装 (#841)。TL 種別ごとの
// 利用可能キーだけをここで検出して渡す
const availableFilterKeys = ref<(keyof TimelineFilter)[]>([])

async function refreshFilterKeys() {
  const host = account.value?.host
  if (!host) {
    availableFilterKeys.value = []
    return
  }
  availableFilterKeys.value = await detectFilterKeys(host, tlType.value)
}

/**
 * 全アカウント面の組込フィルタ候補: ログイン中の全サーバーが対応するキーだけ。
 * サーバーごとに対応が違うキーを出すと、効くサーバーと効かないサーバーが混ざる
 */
const crossFilterKeys = ref<(keyof TimelineFilter)[]>([])
/** 世代。TL 種別やアカウント一覧が続けて変わったとき、遅い検出で上書きしない */
let crossFilterKeysGeneration = 0
async function refreshCrossFilterKeys() {
  const generation = ++crossFilterKeysGeneration
  const hosts = Array.from(
    new Set(
      accountsStore.accounts.filter((a) => a.hasToken).map((a) => a.host),
    ),
  )
  const perHost = await Promise.all(
    hosts.map((host) => detectFilterKeys(host, tlType.value)),
  )
  if (generation !== crossFilterKeysGeneration) return
  crossFilterKeys.value = commonFilterKeys(perHost)
}
if (isCrossAccount.value) {
  watch(
    [
      tlType,
      () =>
        accountsStore.accounts
          .filter((a) => a.hasToken)
          .map((a) => a.host)
          .join(','),
    ],
    () => {
      void refreshCrossFilterKeys()
    },
    { immediate: true },
  )
}

/** 全アカウント面の空状態: クエリによる全件除外と「TL が空」を区別する (仕様追補 E) */
const crossEmptyMessage = computed(() => {
  if (crossQueryState.value.status === 'invalid') {
    return i18n.ts._deckTimelineColumn.queryInvalid
  }
  if (
    crossQueryState.value.status === 'active' &&
    crossQueryExcludedCount.value > 0
  ) {
    return i18n.tsx._deckTimelineColumn.queryExcludedAll_plural({
      count: crossQueryExcludedCount.value,
    })
  }
  return i18n.ts._deckTimelineColumn.noNotes
})

// --- Tab defs for ColumnTabs ---
const tabDefs = computed<ColumnTabDef[]>(() =>
  allTlTypes.value.map((opt) => {
    const icon = getTlIcon(opt.value)
    return {
      value: opt.value,
      label: opt.label,
      icon,
      iconIsSvg: !isTablerIcon(icon),
    }
  }),
)

// --- TL switching ---

function onTabChange(value: string) {
  switchTl(value as TimelineType)
}

async function switchTl(type: TimelineType) {
  if (type === tlType.value) return

  if (isCrossAccount.value) {
    // 全アカウント面はタブごとの snapshot を持たず取り直す (購読も張り直す)
    tlType.value = type
    deckStore.updateColumn(props.column.id, { tl: type })
    await connectCrossAccount()
    return
  }

  // Save current tab snapshot via unified SnapshotStore.
  // unfiltered な orderedIds を保存（ミュート等の可視性を焼き込まない / #574）
  const col = noteColumnRef.value
  if (col) {
    snapshotStore.save(
      props.column.id,
      tlType.value,
      ((col.orderedKeys as VariantKey[] | undefined) ?? []).slice(),
      (col.scroller as HTMLElement | undefined)?.scrollTop ?? 0,
      (
        col.noteScrollerRef as NoteScrollerExpose | null | undefined
      )?.getScrollAnchor?.() ?? null,
    )
  }

  tlType.value = type
  deckStore.updateColumn(props.column.id, { tl: type })
  refreshFilterKeys()

  // Restore snapshot if available, otherwise full reconnect
  const snapshot = snapshotStore.restore(props.column.id, type)
  if (snapshot && snapshot.notes.length > 0) {
    await col?.switchWithSnapshot(
      snapshot.notes,
      snapshot.scrollTop,
      snapshot.anchor,
    )
  } else {
    await reconnect(true)
  }
}

// --- Policies ---

async function applyPolicies(accountId: string, host: string) {
  const [ct, availability] = await Promise.all([
    detectCustomTimelines(host),
    detectAvailableTimelines(accountId),
  ])
  customTimelines.value = ct.filter((c) => {
    if (!availability.denied.has(c.type)) return true
    const modeKey = findModeKeyForTimeline(c.type, availability.modes)
    return modeKey != null && availability.modes[modeKey] === true
  })
  availableStandardTl.value = [
    ...availability.available,
    ...customTimelines.value.map((c) => c.type),
  ]
  tlModes.value = availability.modes
  policyLoaded.value = true
}

async function refreshPolicies() {
  const accountId = props.column.accountId
  const host =
    account.value?.host ?? accountsStore.accountMap.get(accountId ?? '')?.host
  if (!accountId || !host) return
  clearAvailableTlCache(accountId)
  await applyPolicies(accountId, host)
}

// --- Mode version watch (per-account: only react to this column's account) ---
watch(
  () => {
    const aid = props.column.accountId
    return aid ? accountsStore.getModeVersion(aid) : -1
  },
  async () => {
    const accountId = props.column.accountId
    if (accountId) clearRuntimeDenied(accountId)
    await refreshPolicies()
    if (!availableStandardTl.value.includes(tlType.value)) {
      switchTl(availableStandardTl.value[0] ?? 'local')
    } else {
      await reconnect()
    }
  },
)

// --- Startup: detect policies and custom TLs ---
onMounted(async () => {
  const accountId = props.column.accountId

  // Wait for accounts to load so accountMap is populated.
  // Without this, host is undefined in production (Tauri IPC is slower),
  // which skips the policy check and connects with an unauthorized TL type.
  if (!accountsStore.isLoaded) {
    await accountsStore.loadAccounts()
  }

  const host = accountId
    ? accountsStore.accountMap.get(accountId)?.host
    : undefined
  fetchAds()
  // フィルタキー検出 (api/endpoint への往復) はメニューの出し分けにしか
  // 使わないので初回接続の前提にしない。以前は applyPolicies と一緒に
  // await していたため、DB キャッシュからの初回描画までサーバー往復 +
  // Rust 側の full-ready を直列で待っていた
  if (host && accountId) void refreshFilterKeys()
  try {
    if (host && accountId) {
      await applyPolicies(accountId, host)
      if (availableStandardTl.value.length === 0) {
        // Nothing reachable for this account (e.g. guest on a closed server).
        // Leave connectReady=false so useNoteColumn doesn't fire a doomed fetch.
        return
      }
      if (!availableStandardTl.value.includes(tlType.value)) {
        // Only update tlType synchronously here — full reconnect will happen
        // via connectReady watcher in useNoteColumn, avoiding a double-connect race.
        const fallback = availableStandardTl.value[0] ?? 'local'
        tlType.value = fallback
        deckStore.updateColumn(props.column.id, { tl: fallback })
      }
    }
  } catch (e) {
    // Policy detection failed — show all tabs as fallback so the column
    // remains usable. Individual tabs will be removed at runtime if disabled.
    console.warn('[DeckTimelineColumn] policy detection failed:', e)
  }
  connectReady.value = true
})
</script>

<template>
  <!-- Cross-account mode (#1059): ホーム / グローバルを全アカウントで混ぜて束ねる -->
  <DeckColumn
    v-if="isCrossAccount"
    :column-id="column.id"
    :title="column.name || i18n.ts._columns.timeline"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
    @refresh="connectCrossAccount"
  >
    <template #header-icon>
      <i :class="['ti ti-' + currentTlIcon, $style.tlHeaderIcon]" />
    </template>

    <template #header-extra>
      <div :class="$style.subHeaderRow">
        <div :class="$style.subHeaderMain">
          <ColumnTabs
            :tabs="crossTabDefs"
            :model-value="tlType"
            :swipe-target="swipeTarget"
            compact
            @update:model-value="onTabChange"
          />
        </div>
        <!-- per-account と同じバッジ + フィルタメニュー (組込 + クエリ) -->
        <ColumnQueryBadge
          :state="crossQueryState"
          :error-count="crossQueryErrorCount"
          @open="deckStore.toggleSidebarColumn('queryManager', null)"
        />
        <ColumnFilterButton
          :column="column"
          :filter-keys="crossFilterKeys"
          :theme-vars="columnThemeVars"
        />
      </div>
    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      is-error
      :image-url="serverErrorImageUrl"
      :cta-label="i18n.ts._common.retry"
      cta-icon="ti-refresh"
      @cta="connectCrossAccount"
    />

    <div v-else :class="$style.tlBody">
      <ColumnPullFrame
        :is-pulling="crossIsPulling"
        :is-pulled-enough="crossIsPulledEnough"
        :is-refreshing="crossIsRefreshing"
        :height="crossPullHeight()"
      />
      <ColumnQueryBanners
        :state="crossQueryState"
        :error-count="crossQueryErrorCount"
        :missing-ids="crossQueryMissingIds"
        :suspended-keys="crossQuerySuspendedKeys"
        :suspended-count="crossQuerySuspendedCount"
        @resume="crossResumeSuspendedQueries"
        @drop-missing="crossDropMissingQueryRefs"
      />
      <ColumnEmptyState
        v-if="crossNotes.length === 0 && !isLoading"
        :message="crossEmptyMessage"
        :image-url="serverInfoImageUrl"
      />

      <template v-else>
        <button
          v-if="pendingCount > 0"
          :class="$style.newNotesBanner"
          class="_button"
          @click="scrollToTop()"
        >
          <i class="ti ti-arrow-up" />{{ i18n.ts._deckTimelineColumn.newNotes }}
        </button>

        <NoteScroller
          ref="noteScrollerRef"
          :items="groups"
          :animating-ids="animatingRowKeys"
          :class="$style.tlScroller"
          @scroll="handleScroll"
          @near-end="loadMoreCrossAccount"
        >
          <template #default="{ item }">
            <div>
              <MkNote
                :note="item.primary"
                :group="item"
                @react="handlers.reaction"
                @reply="handlers.reply"
                @renote="handlers.renote"
                @quote="handlers.quote"
                @delete="removeNote"
                @edit="handlers.edit"
                @bookmark="handlers.bookmark"
                @delete-and-edit="handlers.deleteAndEdit"
                @vote="handlers.vote"
              />
            </div>
          </template>

          <template #append>
            <!-- 全アカウント取得中は「N アカウントのうち M 件待ち」(#1095)。
                 初回 (0 件) でも止まって見えないよう同じ枠に出す -->
            <div v-if="isLoading && crossProgress" :class="$style.loadingMore">
              <CrossAccountProgress :progress="crossProgress" :size="20" />
            </div>
            <div v-else-if="isLoading && crossNotes.length > 0" :class="$style.loadingMore">
              <LoadingSpinner />
            </div>
          </template>
        </NoteScroller>
      </template>
    </div>
  </DeckColumn>

  <DeckNoteColumn
    v-else
    ref="noteColumnRef"
    :column="column"
    :title="i18n.ts._columns.timeline"
    icon="ti-home"
    sound-enabled
    :note-column-config="noteColumnConfig"
    :filter-keys="availableFilterKeys"
  >
    <template #header-icon>
      <span :class="$style.tlHeaderIconWrap">
        <i v-if="isTablerIcon(currentTlIcon)" :class="['ti ti-' + currentTlIcon, $style.tlHeaderIcon]" />
        <svg v-else :class="$style.tlHeaderIcon" viewBox="0 0 24 24" width="14" height="14">
          <path :d="currentTlIcon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </span>
    </template>

    <template #header-extra>
      <ColumnTabs
        :tabs="tabDefs"
        :model-value="tlType"
        :swipe-target="swipeTarget"
        compact
        @update:model-value="onTabChange"
      />
    </template>

    <template #note-item="{ index }">
      <MkAd v-if="shouldShowAd(index)" :ad="pickAd(index)!" :server-host="serverHost" @mute="muteAd" />
    </template>
  </DeckNoteColumn>

  <ColumnCrossPostForm v-if="isCrossAccount" :post-form="postForm" @posted="postForm.close" />
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.tlHeaderIconWrap {
  display: inline-flex;
  align-items: center;
}

/* tlHeaderIcon は column-common.module.scss から継承、font-size のみ拡張 */
.tlHeaderIcon {
  font-size: 14px;
}

/* 全アカウント面のサブヘッダ (per-account の DeckNoteColumn と同じ行構成) */
.subHeaderRow {
  display: flex;
  align-items: stretch;
  background: var(--nd-bg);
}

.subHeaderMain {
  flex: 1;
  min-width: 0;
}
</style>
