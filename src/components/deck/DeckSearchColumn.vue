<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import type {
  NormalizedNote,
  NormalizedUser,
  SearchOptions,
  TimelineFilter,
} from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import CrossAccountProgress from '@/components/common/CrossAccountProgress.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useNavigation } from '@/composables/useNavigation'
import { provideNoteFrame } from '@/composables/useNoteFrame'
import { usePortal } from '@/composables/usePortal'
import {
  loadSearchScopeMeta,
  useSearchScopeMeta,
} from '@/composables/useSearchScopeMeta'
import { i18n } from '@/i18n'
import type { NoteGroup } from '@/services/noteGroup'
import { variantKeyOf } from '@/services/noteKey'
import {
  type AuthorResolution,
  dateBounds,
  effectiveConditions,
  effectiveHostParam,
  hasActiveFilter,
  hostPlanForAccount,
  matchesPlainTerm,
  matchesTextConditions,
  parseAuthor,
  type SearchFilter,
  type SearchScopeMeta,
  type ServerHostOption,
  serverHostOptions,
  unionHostOptions,
} from '@/services/searchFilter'
import { mapWithConcurrency, type SettleProgress } from '@/utils/concurrency'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

import { useColumnSetup } from '@/composables/useColumnSetup'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useNoteFocus } from '@/composables/useNoteFocus'
import { useNoteList } from '@/composables/useNoteList'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { AppError } from '@/utils/errors'
import { isImeComposing } from '@/utils/ime'
import { matchesFilter } from '@/utils/timelineFilter'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import ColumnFilterButton from './ColumnFilterButton.vue'
import DeckColumn from './DeckColumn.vue'
import SearchFilterPanel from './SearchFilterPanel.vue'

function collectFulfilled<T>(results: PromiseSettledResult<T[]>[]): T[] {
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

const props = defineProps<{
  column: DeckColumnType
}>()

const isCrossAccount = computed(() => props.column.accountId == null)
/** 全アカウントのサーバー検索の進捗 (#1095)。取得中以外は null */
const crossProgress = ref<SettleProgress | null>(null)
/**
 * 検索の世代。同じクエリで条件 (日付・並び順) だけ変えた再実行はクエリ文字列
 * では区別できないので、走行中の検索が古いかどうかは世代で判定する
 */
let searchGeneration = 0
// 全アカウント面ではノートの基準サーバーを絶対にする (#1059)
provideNoteFrame(isCrossAccount)
const accountsStore = useAccountsStore()
const multiAdapters = useMultiAccountAdapters()

const deckStore = useDeckStore()
const {
  account,
  columnThemeVars,
  serverIconUrl,
  serverInfoImageUrl,
  serverNotFoundImageUrl,
  serverErrorImageUrl,
  isLoading,
  error,
  initAdapter,
  getAdapter,
  disconnect,
  postForm,
  handlers,
  scroller,
  onScroll,
} = useColumnSetup(() => props.column)

const { navigateToNote } = useNavigation()
// 列は useNoteList (行キーの順序配列 + noteStore) に載せる。全アカウント面は
// 同一 identity の variant を 1 行に束ねる (#1058)。サーバー検索とローカル FTS の
// 2 段マージ・昇順/降順・正規表現はこのカラム側で決め、列には結果だけを書く。
// 表示用 notes は述語で隠す（#606）。検索は一覧面なので opt-out なし
const { notes, groups, rawNotes, setNotes, removeNote } = useNoteList({
  bundle: isCrossAccount.value,
  getAdapter,
  // 全アカウント面は variant の取得元アカウントで消す。成功時の noteStore.remove
  // (tombstone) と SQLite キャッシュ削除は useNoteList.removeNote が担う
  deleteHandler: handlers.delete,
  closePostForm: postForm.close,
})

/** 行 = 全アカウントなら group、per-account なら variant 1 個の擬似 group */
interface SearchRow {
  rowKey: string
  primary: NormalizedNote
  group?: NoteGroup
}
const rows = computed<SearchRow[]>(() =>
  isCrossAccount.value
    ? groups.value.map((g) => ({
        rowKey: g.rowKey,
        primary: g.primary,
        group: g,
      }))
    : notes.value.map((n) => ({ rowKey: variantKeyOf(n), primary: n })),
)

const noteScrollerRef = ref<{
  getElement: () => HTMLElement | null
  scrollToIndex: (
    index: number,
    opts?: { align?: string; behavior?: string },
  ) => void
} | null>(null)
watch(
  noteScrollerRef,
  () => {
    scroller.value = noteScrollerRef.value?.getElement() ?? null
  },
  { flush: 'post' },
)
const { focusedNoteId } = useNoteFocus(
  props.column.id,
  notes,
  scroller,
  { ...handlers, delete: removeNote, edit: handlers.edit },
  (note) => navigateToNote(note._accountId, note.id),
  undefined,
  (index) => noteScrollerRef.value?.scrollToIndex(index),
)

const postPortalRef = useTemplateRef<HTMLElement>('postPortalRef')
usePortal(postPortalRef)

const searchQuery = ref(props.column.query ?? '')
const searchInput = ref<HTMLInputElement | null>(null)
const hasLocalResults = ref(false)
const isPreview = ref(false)
const confirmedQuery = ref('')
/** 検索バーの下に出す検索の失敗 (無効な正規表現 / 照合の失敗 / 投稿者の未解決) */
const inlineError = ref<string | null>(null)

// --- 絞り込み (#1180)。正本は column.searchFilter、ここはその写し ---
const filter = ref<SearchFilter>({ ...props.column.searchFilter })
// 外部からの差し替え (ハッシュタグ / CLI / AI) を取り込む
watch(
  () => props.column.searchFilter,
  (f) => {
    filter.value = { ...f }
  },
)
function saveFilter(next: SearchFilter) {
  filter.value = next
  deckStore.updateColumn(props.column.id, { searchFilter: next })
}
const ascending = computed(() => filter.value.ascending === true)

const scopeMeta = useSearchScopeMeta(computed(() => props.column.accountId))
/** 全アカウント面: アカウントごとのサーバーの検索範囲の設定 (#1182) */
const crossMetas = ref<Record<string, SearchScopeMeta>>({})
watch(
  () => (isCrossAccount.value ? accountsStore.accounts.map((a) => a.id) : []),
  (ids) => {
    for (const id of ids) {
      if (crossMetas.value[id]) continue
      void loadSearchScopeMeta(id).then((m) => {
        crossMetas.value = { ...crossMetas.value, [id]: m }
      })
    }
  },
  { immediate: true },
)
function hostOptionsFor(accountId: string): ServerHostOption[] {
  return serverHostOptions(
    isCrossAccount.value ? crossMetas.value[accountId] : scopeMeta.value,
  )
}
/** 範囲の選択肢。全アカウント面は各サーバーの和集合 (出せないサーバーには投げない) */
const hostOptions = computed(() =>
  isCrossAccount.value
    ? unionHostOptions(
        accountsStore.accounts.map((a) => crossMetas.value[a.id]),
      )
    : serverHostOptions(scopeMeta.value),
)
/** 範囲か投稿者の条件で問い合わせなかったアカウント (0 件と見分けるため、サーバーごとに理由を見せる) */
type SkipReason = 'scope' | 'author'
const crossSkipped = ref<{ host: string; reason: SkipReason }[]>([])
function hostOf(accountId: string): string {
  return (
    accountsStore.accounts.find((a) => a.id === accountId)?.host ??
    account.value?.host ??
    ''
  )
}

// --- 条件の変更 → 再検索 (短時間の連続変更は 1 回にまとめる) ---
let filterTimer: ReturnType<typeof setTimeout> | null = null
/**
 * ノートカラムと同じ組込トグル (#841 の規則で意味を持つものだけ)。リノートは
 * 本文照合の検索に出てこないので出さない。評価はサーバーから返ったページへの
 * 手元判定 (検索 API に返信 / Bot のパラメータは無い)
 */
const BUILTIN_FILTER_KEYS: (keyof TimelineFilter)[] = [
  'withReplies',
  'withBots',
  'withSensitive',
]
// 組込トグルはフィルターメニューがカラムに直接書くので、変化を見て引き直す
watch(
  () => JSON.stringify(props.column.filters ?? null),
  (next, prev) => {
    if (next !== prev) scheduleResearch()
  },
)

function scheduleResearch() {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    filterTimer = null
    if (confirmedQuery.value) performSearch()
  }, 400)
}

function onFilterUpdate(next: SearchFilter) {
  saveFilter(next)
  scheduleResearch()
}

function toggleSort() {
  const next = { ...filter.value }
  if (next.ascending) delete next.ascending
  else next.ascending = true
  saveFilter(next)
  scheduleResearch()
}

// 検索語の欄に手で打ったら、外部差し替えで止めていた本文の条件を戻す
function onQueryInput() {
  if (!filter.value.conditionsPaused) return
  const next = { ...filter.value }
  delete next.conditionsPaused
  saveFilter(next)
}

// --- 投稿者の解決 (アカウントごとに ID が違う。全アカウント面は各アカウントで解決、#1182) ---
/** 解決中のアカウント数 */
const authorResolving = ref(0)
const authorAccountIds = computed<string[]>(() =>
  isCrossAccount.value
    ? accountsStore.accounts.map((a) => a.id)
    : props.column.accountId
      ? [props.column.accountId]
      : [],
)
const authorState = computed<'resolving' | 'resolved' | 'unresolved' | null>(
  () => {
    const ids = authorAccountIds.value
    if (ids.length === 0) return null
    if (authorResolving.value > 0) return 'resolving'
    const results = ids.map((id) => filter.value.authorIds?.[id])
    if (results.some((r) => r)) return 'resolved'
    if (results.every((r) => r === null)) return 'unresolved'
    return null
  },
)
const authorResolvedLabel = computed(() => {
  const ids = authorAccountIds.value
  const resolved = ids
    .map((id) => filter.value.authorIds?.[id])
    .filter((r): r is AuthorResolution => Boolean(r))
  if (resolved.length === 0) return ''
  // 全アカウント面は解決できた acct を並べる (見つからなかったサーバーは対象外の一覧に出る)
  return resolved.map((r) => r.acct || r.id).join(', ')
})

function acctOf(user: NormalizedUser, accountHost: string): string {
  return `${user.username}@${user.host ?? accountHost}`
}

/** 単一アカウントはカラムの adapter、全アカウント面はアカウントごとの adapter */
async function adapterFor(accountId: string) {
  return isCrossAccount.value
    ? multiAdapters.getOrCreate(accountId)
    : initAdapter()
}

function saveAuthorId(
  accountId: string,
  res: AuthorResolution | null,
  author?: string,
) {
  const next: SearchFilter = {
    ...filter.value,
    authorIds: { ...filter.value.authorIds, [accountId]: res },
  }
  if (author) next.author = author
  saveFilter(next)
}

/**
 * 投稿者の条件をこのアカウントの ID に解決する。undefined = 条件なし、
 * null = 未解決 (このアカウントでは検索しない)。表記が変わるまで結果は保存し、
 * 変わると panel 側が authorIds を捨てるので解決し直す
 */
async function resolveAuthor(
  accountId: string,
): Promise<AuthorResolution | null | undefined> {
  const known = filter.value.authorIds?.[accountId]
  if (known !== undefined) return known
  const parsed = parseAuthor(filter.value.author ?? '')
  if (!parsed) return undefined
  authorResolving.value++
  try {
    const adapter = await adapterFor(accountId)
    if (!adapter) return null
    const user = await adapter.api.lookupUser(parsed.username, parsed.host)
    const res: AuthorResolution = {
      id: user.id,
      acct: acctOf(user, hostOf(accountId)),
    }
    saveAuthorId(accountId, res)
    return res
  } catch {
    saveAuthorId(accountId, null)
    return null
  } finally {
    authorResolving.value--
  }
}

/** 移行で入った ID だけの条件 (acct 無し) に、表示のため一度だけ表記を補う */
async function hydrateMigratedAuthor(accountId: string) {
  const res = filter.value.authorIds?.[accountId]
  if (!res || res.acct) return
  try {
    const adapter = await adapterFor(accountId)
    if (!adapter) return
    const user = await adapter.api.getUser(res.id)
    // 待っている間に表記が変わっていたら触らない
    if (filter.value.authorIds?.[accountId]?.id !== res.id) return
    const acct = acctOf(user, hostOf(accountId))
    saveAuthorId(
      accountId,
      { id: res.id, acct },
      filter.value.author ? undefined : acct,
    )
  } catch {
    // 表記が無くても ID で検索はできる
  }
}

// --- 評価 ---
/**
 * 手元の照合 (1 層)。母集合は検索語の結果で、リテラル含有 (サーバーの
 * トークナイズによる曖昧一致を揃える) で絞り、そのあと本文の条件を当てる。
 * ローカル先行表示 / 確定 / 段階表示 / 追加読み込みのすべてがここを通る
 */
function applyLocalFilter(
  notes: NormalizedNote[],
  q: string,
): NormalizedNote[] {
  // 組込トグル (最安) → 検索語の含有 → 本文の条件
  const byTerm = notes.filter(
    (n) => matchesFilter(n, props.column.filters) && matchesPlainTerm(n, q),
  )
  const conditions = effectiveConditions(filter.value)
  if (conditions.length === 0) return byTerm
  return byTerm.filter((n) => matchesTextConditions(n, conditions))
}

type SearchPlan =
  | { kind: 'ok'; opts: SearchOptions }
  | { kind: 'skip'; reason: SkipReason }

/**
 * そのアカウントのサーバーへ渡す条件。skip = このアカウントには投げない
 * (範囲の選択肢を出せないサーバー / 投稿者が未解決) で、理由ごと見せる。
 * 全アカウント面では「すべて」「ホスト指定」を出せるサーバーだけに投げ、
 * 指定ホストがそのサーバー自身ならローカルとして渡す (#1182)
 */
function planFor(accountId: string): SearchPlan {
  const { since, until } = dateBounds(filter.value)
  const opts: SearchOptions = {}
  if (since) opts.sinceDate = Date.parse(since)
  if (until) opts.untilDate = Date.parse(until)
  if (isCrossAccount.value) {
    const plan = hostPlanForAccount(
      filter.value.host,
      hostOf(accountId),
      hostOptionsFor(accountId),
    )
    if (plan.kind === 'skip') return { kind: 'skip', reason: 'scope' }
    if (plan.host) opts.host = plan.host
  } else {
    const host = effectiveHostParam(filter.value.host, hostOf(accountId))
    if (host) opts.host = host
  }
  if (filter.value.author) {
    const author = filter.value.authorIds?.[accountId]
    if (!author) return { kind: 'skip', reason: 'author' }
    opts.userId = author.id
  }
  return { kind: 'ok', opts }
}

/** 単一アカウント面の条件 (投げない理由は別に表示するので、条件だけ取り出す) */
function serverOptionsOrEmpty(accountId: string): SearchOptions {
  const plan = planFor(accountId)
  return plan.kind === 'ok' ? plan.opts : {}
}

/** 全アカウント面のローカル先行表示を、各ノートの取得元アカウントの範囲 / 投稿者に揃える */
function matchesScopeCross(note: NormalizedNote): boolean {
  if (filter.value.author) {
    const res = filter.value.authorIds?.[note._accountId]
    if (!res || note.user.id !== res.id) return false
  }
  const host = effectiveHostParam(filter.value.host, note._serverHost)
  if (!host) return true
  if (host === '.') return note.user.host === null
  return (note.user.host ?? note._serverHost).toLowerCase() === host
}

/**
 * 手元の索引にはサーバーの host / userId が効かないので、per-account の
 * ローカル結果を同じ範囲に揃える
 */
function matchesServerScope(
  note: NormalizedNote,
  authorId: string | undefined,
): boolean {
  if (authorId && note.user.id !== authorId) return false
  const host = account.value
    ? effectiveHostParam(filter.value.host, account.value.host)
    : undefined
  if (!host) return true
  if (host === '.') return note.user.host === null
  return (note.user.host ?? note._serverHost).toLowerCase() === host
}

async function searchLocalDb(
  accountId: string,
  hint: string,
  limit: number | null,
): Promise<NormalizedNote[]> {
  const { since, until } = dateBounds(filter.value)
  return unwrap(
    await commands.apiSearchNotesLocal(
      accountId,
      hint,
      limit,
      since,
      until,
      ascending.value,
    ),
  ) as NormalizedNote[]
}

function mergeNotes(
  existing: NormalizedNote[],
  incoming: NormalizedNote[],
): NormalizedNote[] {
  // 行の一意性は取得元アカウント + note id (#1010)。全アカウント検索では
  // 別サーバー由来の同じ id が並ぶ
  const seen = new Set(existing.map(variantKeyOf))
  const merged = [...existing]
  for (const note of incoming) {
    const key = variantKeyOf(note)
    if (!seen.has(key)) {
      merged.push(note)
      seen.add(key)
    }
  }
  const dir = ascending.value ? 1 : -1
  return merged.sort((a, b) => dir * a.createdAt.localeCompare(b.createdAt))
}

// --- ページング: 位置は照合前の生ページで持つ (1 ページ丸ごと落ちても進む) ---
/** per-account: 最後に取得した生ページの最古 id。尽きたら以後は問い合わせない */
let fetchCursor: string | null = null
let fetchExhausted = false
/** 全アカウント: アカウントごとの位置と、結果が尽きたアカウント */
const crossCursors = new Map<string, string>()
const crossExhausted = new Set<string>()

function resetCursors() {
  fetchCursor = null
  fetchExhausted = false
  crossCursors.clear()
  crossExhausted.clear()
}

function oldestIdOf(page: NormalizedNote[]): string | null {
  let oldest: NormalizedNote | undefined
  for (const n of page) {
    if (!oldest || n.createdAt < oldest.createdAt) oldest = n
  }
  return oldest?.id ?? null
}

function advanceCursor(page: NormalizedNote[]) {
  const id = oldestIdOf(page)
  if (id) fetchCursor = id
  else fetchExhausted = true
}

function advanceCrossCursor(accountId: string, page: NormalizedNote[]) {
  const id = oldestIdOf(page)
  if (id) crossCursors.set(accountId, id)
  else crossExhausted.add(accountId)
}

// Incremental local search (typeahead)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function searchLocal(q: string) {
  if (!q) return
  const hint = q

  if (isCrossAccount.value) {
    await searchLocalCrossAccount(q, hint)
  } else {
    await searchLocalPerAccount(q, hint)
  }
}

async function searchLocalPerAccount(q: string, hint: string) {
  const accountId = props.column.accountId
  if (!accountId) return
  const authorId = filter.value.authorIds?.[accountId]?.id
  // 投稿者が未解決のうちは範囲を揃えられないので先行表示しない
  if (filter.value.author && !authorId) return
  try {
    const local = await searchLocalDb(accountId, hint, 10)
    const matched = applyLocalFilter(local, q).filter((n) =>
      matchesServerScope(n, authorId),
    )
    if (searchQuery.value.trim() === q) {
      rawNotes.value = matched
      isPreview.value = true
      hasLocalResults.value = matched.length > 0
    }
  } catch {
    // ローカル索引の失敗は致命ではない
  }
}

async function searchLocalCrossAccount(q: string, hint: string) {
  const accounts = accountsStore.accounts
  try {
    const results = await Promise.allSettled(
      accounts.map((acc) => searchLocalDb(acc.id, hint, 10)),
    )
    const matched = applyLocalFilter(collectFulfilled(results), q).filter(
      matchesScopeCross,
    )
    if (searchQuery.value.trim() === q) {
      rawNotes.value = mergeNotes([], matched)
      isPreview.value = true
      hasLocalResults.value = matched.length > 0
    }
  } catch {
    // ローカル索引の失敗は致命ではない
  }
}

watch(searchQuery, (val) => {
  const q = val.trim()
  if (debounceTimer) clearTimeout(debounceTimer)
  inlineError.value = null
  if (!q) {
    rawNotes.value = []
    isPreview.value = false
    hasLocalResults.value = false
    return
  }
  // Don't show preview if already showing confirmed results for this query
  if (q === confirmedQuery.value) return
  debounceTimer = setTimeout(() => searchLocal(q), 200)
})

// ハッシュタグクリック等で外部から query が差し替えられたとき (deck.openSearchWith)。
// 条件も store 側で差し替え済み (externalQueryPatch) なので一緒に取り込む
watch(
  () => props.column.query,
  (q) => {
    if (!q || q === confirmedQuery.value) return
    searchQuery.value = q
    filter.value = { ...props.column.searchFilter }
    // 手入力フローと違いプレビュー検索を経ないため、前クエリの結果に
    // server 結果が merge されないようリセットしてから検索する
    rawNotes.value = []
    hasLocalResults.value = false
    performSearch()
  },
)

async function performSearch() {
  const q = searchQuery.value.trim()
  if (!q) return
  if (debounceTimer) clearTimeout(debounceTimer)
  if (filterTimer) {
    clearTimeout(filterTimer)
    filterTimer = null
  }

  error.value = null
  inlineError.value = null
  isLoading.value = true
  isPreview.value = false
  confirmedQuery.value = q
  const gen = ++searchGeneration
  resetCursors()
  crossSkipped.value = []

  deckStore.updateColumn(props.column.id, { query: q })

  const hint = q

  if (isCrossAccount.value) {
    await performSearchCrossAccount(q, hint, gen)
  } else {
    await performSearchPerAccount(q, hint, gen)
  }

  // 走行中に別の検索が始まっていたら、その表示状態を奪わない
  if (gen === searchGeneration) isLoading.value = false
}

async function performSearchPerAccount(q: string, hint: string, gen: number) {
  const accountId = props.column.accountId
  if (!accountId || !hint) return

  const author = await resolveAuthor(accountId)
  if (gen !== searchGeneration) return
  if (author === null) {
    inlineError.value = i18n.ts._deckSearchColumn.authorUnresolved
    rawNotes.value = []
    hasLocalResults.value = false
    return
  }

  // Local search first (instant) if not already showing preview
  if (!hasLocalResults.value) {
    try {
      const local = await searchLocalDb(accountId, hint, null)
      const matched = applyLocalFilter(local, q).filter((n) =>
        matchesServerScope(n, author?.id),
      )
      if (gen !== searchGeneration) return
      if (matched.length > 0) {
        rawNotes.value = matched
        hasLocalResults.value = true
      }
    } catch {
      // ローカル索引の失敗は致命ではない
    }
  }

  // Server search
  if (account.value) {
    try {
      const adapter = await initAdapter()
      if (!adapter) return
      const page = await adapter.api.searchNotes(
        hint,
        serverOptionsOrEmpty(accountId),
      )
      if (gen !== searchGeneration) return
      advanceCursor(page)
      const matched = applyLocalFilter(page, q)
      rawNotes.value = mergeNotes(
        hasLocalResults.value ? rawNotes.value : [],
        matched,
      )
    } catch (e) {
      if (gen !== searchGeneration) return
      if (!hasLocalResults.value) {
        error.value = AppError.from(e)
      }
    }
  }
}

async function performSearchCrossAccount(q: string, hint: string, gen: number) {
  const accounts = accountsStore.accounts
  if (!hint) return

  // Local search first (instant) if not already showing preview
  if (!hasLocalResults.value) {
    try {
      const localResults = await Promise.allSettled(
        accounts.map((acc) => searchLocalDb(acc.id, hint, null)),
      )
      const matched = applyLocalFilter(
        collectFulfilled(localResults),
        q,
      ).filter(matchesScopeCross)
      if (gen !== searchGeneration) return
      if (matched.length > 0) {
        rawNotes.value = mergeNotes([], matched)
        hasLocalResults.value = true
      }
    } catch {
      // ローカル索引の失敗は致命ではない
    }
  }

  // Server search across all accounts。返ったアカウントの分から順に出す
  // (#1095)。Meilisearch 未導入のサーバーは PostgreSQL 走査で遅く、1 つの
  // 遅いサーバーが他の結果まで止めていた。検索は「速い分から」で素直に
  // 良くなる面なので初回から段階的に描く
  // 投稿者はアカウントごとに解決し、解決できたアカウントだけに投げる (#1182)
  if (filter.value.author) {
    await Promise.all(accounts.map((acc) => resolveAuthor(acc.id)))
    if (gen !== searchGeneration) return
  }
  const skipped: { host: string; reason: SkipReason }[] = []
  const targets = accounts.flatMap((acc) => {
    const plan = planFor(acc.id)
    if (plan.kind === 'skip') {
      skipped.push({ host: acc.host, reason: plan.reason })
      return []
    }
    return [{ acc, opts: plan.opts }]
  })
  crossSkipped.value = skipped
  crossProgress.value = { done: 0, total: targets.length }
  let merged = hasLocalResults.value ? rawNotes.value : []
  try {
    await mapWithConcurrency(
      targets,
      async ({ acc, opts }) => {
        const adapter = await multiAdapters.getOrCreate(acc.id)
        if (!adapter) return []
        return adapter.api.searchNotes(hint, opts)
      },
      Math.max(1, targets.length),
      async (r, { acc }, progress) => {
        // 走行中に別の検索が始まっていたら、その結果に上書きしない
        if (gen !== searchGeneration) return
        crossProgress.value = progress
        if (r.status !== 'fulfilled') return
        advanceCrossCursor(acc.id, r.value)
        merged = mergeNotes(merged, applyLocalFilter(r.value, q))
        rawNotes.value = merged
      },
    )
    if (gen === searchGeneration) rawNotes.value = merged
  } catch (e) {
    if (gen === searchGeneration && !hasLocalResults.value) {
      error.value = AppError.from(e)
    }
  } finally {
    if (gen === searchGeneration) crossProgress.value = null
  }
}

async function loadMore() {
  if (isCrossAccount.value) {
    await loadMoreCrossAccount()
  } else {
    await loadMorePerAccount()
  }
}

async function loadMorePerAccount() {
  const accountId = props.column.accountId
  const adapter = getAdapter()
  if (!adapter || !accountId || isLoading.value) return
  if (fetchExhausted || !fetchCursor) return

  const q = confirmedQuery.value
  const hint = q
  if (!hint) return

  const gen = searchGeneration
  isLoading.value = true
  try {
    const page = await adapter.api.searchNotes(hint, {
      ...serverOptionsOrEmpty(accountId),
      untilId: fetchCursor,
    })
    if (gen !== searchGeneration) return
    advanceCursor(page)
    const older = applyLocalFilter(page, q)
    // 古い側を足したので、昇順なら先頭 (古い側) を、降順なら末尾を残す
    setNotes(
      mergeNotes(rawNotes.value, older),
      ascending.value ? 'oldest' : 'newest',
    )
  } catch (e) {
    if (gen !== searchGeneration) return
    error.value = AppError.from(e)
  } finally {
    if (gen === searchGeneration) isLoading.value = false
  }
}

async function loadMoreCrossAccount() {
  if (isLoading.value) return

  const q = confirmedQuery.value
  const hint = q
  if (!hint) return

  // 尽きたアカウントと、範囲 / 投稿者の条件で対象外のアカウントには問い合わせない。
  // 位置が無いアカウント (初回が落ちた) は先頭から
  const targets = accountsStore.accounts.flatMap((acc) => {
    if (crossExhausted.has(acc.id)) return []
    const plan = planFor(acc.id)
    return plan.kind === 'ok' ? [{ acc, opts: plan.opts }] : []
  })
  if (targets.length === 0 || crossCursors.size === 0) return
  const gen = searchGeneration
  isLoading.value = true

  try {
    crossProgress.value = { done: 0, total: targets.length }
    await mapWithConcurrency(
      targets,
      async ({ acc, opts }) => {
        const adapter = await multiAdapters.getOrCreate(acc.id)
        if (!adapter) return []
        return adapter.api.searchNotes(hint, {
          ...opts,
          untilId: crossCursors.get(acc.id),
        })
      },
      targets.length,
      // 返ったアカウントの分から順に足す (#1095)。untilId で古い側へ進むほど
      // 遅くなるサーバーを、速いサーバーの分まで待たせない
      async (r, { acc }, progress) => {
        if (gen !== searchGeneration) return
        crossProgress.value = progress
        if (r.status !== 'fulfilled') return
        advanceCrossCursor(acc.id, r.value)
        const older = applyLocalFilter(r.value, q)
        if (older.length === 0) return
        setNotes(
          mergeNotes(rawNotes.value, older),
          ascending.value ? 'oldest' : 'newest',
        )
      },
    )
  } catch (e) {
    if (gen === searchGeneration) error.value = AppError.from(e)
  } finally {
    if (gen === searchGeneration) {
      isLoading.value = false
      crossProgress.value = null
    }
  }
}

async function handlePosted(editedNoteId?: string) {
  postForm.close()
  if (editedNoteId) {
    let adapter: Awaited<ReturnType<typeof multiAdapters.getOrCreate>> = null
    if (isCrossAccount.value) {
      const note = rawNotes.value.find((n) => n.id === editedNoteId)
      if (note) adapter = await multiAdapters.getOrCreate(note._accountId)
    } else {
      adapter = getAdapter()
    }
    if (!adapter) return
    try {
      const updated = await adapter.api.getNote(editedNoteId)
      rawNotes.value = rawNotes.value.map((n) =>
        n.id === editedNoteId
          ? updated
          : n.renoteId === editedNoteId
            ? { ...n, renote: updated }
            : n,
      )
    } catch {
      // note may have been deleted
    }
  }
}

function scrollToTop() {
  nextTick(() => {
    if (noteScrollerRef.value) {
      noteScrollerRef.value.scrollToIndex(0, {
        align: 'start',
        behavior: 'smooth',
      })
    } else if (scroller.value) {
      scroller.value.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })
}

function handleScroll() {
  onScroll(loadMore)
}

function onKeydown(e: KeyboardEvent) {
  if (isImeComposing(e)) return
  if (e.key === 'Enter') {
    performSearch()
  }
}

onMounted(() => {
  if (props.column.accountId) hydrateMigratedAuthor(props.column.accountId)
  if (searchQuery.value) {
    performSearch()
  } else {
    if (!isCrossAccount.value) initAdapter()
    searchInput.value?.focus()
  }
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (filterTimer) clearTimeout(filterTimer)
  disconnect()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || i18n.ts._columns.search"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i :class="$style.tlHeaderIcon" class="ti ti-search" />
    </template>

    <template #header-meta>
    </template>

    <template #header-extra>
      <div :class="$style.searchBar">
        <i :class="$style.searchIcon" class="ti ti-search" />
        <input
          ref="searchInput"
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          :placeholder="i18n.ts._deckSearchColumn.placeholder"
          @input="onQueryInput"
          @keydown="onKeydown"
        />
        <div :class="$style.barControls">
          <button
            :class="[$style.sortToggle, { [$style.sortToggleActive]: ascending }]"
            class="_button"
            :title="ascending ? i18n.ts._deckSearchColumn.oldestFirst : i18n.ts._deckSearchColumn.newestFirst"
            @click="toggleSort"
          >
            <i :class="ascending ? 'ti ti-sort-ascending' : 'ti ti-sort-descending'" />
          </button>
        </div>
        <!-- 絞り込みはノートカラムと同じ漏斗 → ポップアップ (#1180)。検索の行を差し込む -->
        <ColumnFilterButton
          :column="column"
          :filter-keys="BUILTIN_FILTER_KEYS"
          :active="hasActiveFilter(filter)"
          hide-queries
          :theme-vars="columnThemeVars"
          wide
          compact
        >
          <template #extra>
            <SearchFilterPanel
              face="server"
              :filter="filter"
              :host-options="hostOptions"
              :cross-account="isCrossAccount"
              :author-state="authorState"
              :author-resolved-label="authorResolvedLabel"
              @update="onFilterUpdate"
            />
          </template>
        </ColumnFilterButton>
      </div>

      <div v-if="inlineError" :class="$style.inlineError">
        {{ inlineError }}
      </div>
      <!-- 投げなかったサーバーは理由ごとに一覧で見せる (0 件と見分ける、#1182) -->
      <div v-if="isCrossAccount && crossSkipped.length > 0" :class="$style.inlineNote">
        <div v-for="s in crossSkipped" :key="s.host">
          {{ s.reason === 'scope'
            ? i18n.tsx._deckSearchColumn.skippedScope({ host: s.host })
            : i18n.tsx._deckSearchColumn.skippedAuthor({ host: s.host }) }}
        </div>
      </div>

    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      :image-url="serverErrorImageUrl"
      is-error
      :cta-label="i18n.ts._common.retry"
      cta-icon="ti-refresh"
      @cta="performSearch"
    />

    <div v-else :class="$style.searchBody">
      <div v-if="isLoading && notes.length === 0" :class="$style.columnLoading">
        <CrossAccountProgress v-if="crossProgress" :progress="crossProgress" />
        <LoadingSpinner v-else />
      </div>

      <ColumnEmptyState
        v-else-if="!searchQuery.trim() && notes.length === 0"
        :message="i18n.ts._deckSearchColumn.enterQuery"
        :image-url="serverInfoImageUrl"
      />

      <ColumnEmptyState
        v-else-if="searchQuery.trim() && !isLoading && !isPreview && notes.length === 0"
        :message="i18n.ts._deckSearchColumn.noResults"
        :image-url="serverNotFoundImageUrl"
      />

      <NoteScroller
        v-else
        ref="noteScrollerRef"
        :items="rows"
        :focused-id="focusedNoteId"
        :class="$style.searchScroller"
        @scroll="handleScroll"
      >
        <template #default="{ item, index }">
          <div>
            <MkNote
              :note="item.primary"
              :group="item.group"
              :focused="variantKeyOf(item.primary) === focusedNoteId"
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
          <div v-if="isPreview && notes.length > 0" :class="$style.searchPreviewHint">
            {{ i18n.ts._deckSearchColumn.enterToSearch }}
          </div>
          <div v-else-if="isLoading && notes.length > 0" :class="$style.loadingMore">
            <CrossAccountProgress v-if="crossProgress" :progress="crossProgress" :size="20" />
            <LoadingSpinner v-else />
          </div>
        </template>
      </NoteScroller>
    </div>
  </DeckColumn>

  <div v-if="postForm.show.value && column.accountId && account?.hasToken" ref="postPortalRef">
    <MkPostForm
      :account-id="column.accountId"
      :reply-to="postForm.replyTo.value"
      :renote-id="postForm.renoteId.value"
      :edit-note="postForm.editNote.value"
      :initial-note="postForm.initialNote.value"
      :initial-text="postForm.initialText.value"
      :initial-cw="postForm.initialCw.value"
      :initial-visibility="postForm.initialVisibility.value"
      @close="postForm.close"
      @posted="handlePosted"
    />
  </div>
  <ColumnCrossPostForm v-if="isCrossAccount" :post-form="postForm" @posted="handlePosted" />
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.searchBar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
}

.searchIcon {
  flex-shrink: 0;
  opacity: 0.4;
}

.searchInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 6px 10px;
  font-size: 0.85em;
  color: var(--nd-fg);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.barControls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}






.filterToggle,
.sortToggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  opacity: 0.35;
  font-size: 0.9em;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 0.7;
  }
}

.filterToggleActive,
.sortToggleActive {
  opacity: 1;
  color: var(--nd-accent);
}

// 外部からの検索語の差し替えで本文の条件が止まっている

.inlineError {
  padding: 4px 12px;
  font-size: 0.75em;
  color: var(--nd-love);
}

.inlineNote {
  padding: 4px 12px;
  font-size: 0.75em;
  opacity: 0.6;
}


.searchBody {
  composes: tlBody from './column-common.module.scss';
}

.searchScroller {
  flex: 1;
  overflow-x: clip;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.searchPreviewHint {
  text-align: center;
  padding: 0.75rem 1rem;
  font-size: 0.75em;
  opacity: 0.4;
  border-top: 1px solid var(--nd-divider);
}




@keyframes conditionsIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
}

@keyframes conditionsOut {
  to {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
}

/* 実行ボタンはヘッダーバーに置く (API コンソールなど他のカラムの実行操作と同じ位置) */
</style>

