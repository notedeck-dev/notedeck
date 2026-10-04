/**
 * 検索カラムの絞り込み (#1180) の純ロジック。サーバー検索 (`search` 種別、
 * Misskey の notes/search) とクライアント検索 (`clientSearch` 種別、手元の索引)
 * は並立する別の面だが、絞り込みパネルと条件モデルは 1 つを共有する。
 *
 * 条件は面を問わず `DeckColumn.searchFilter` に保存する。同じ行でも意味が
 * 違うもの (範囲 / 投稿者 / 並び順) は別の属性に分けて互いに読み替えない。
 */

import type { DeckColumn } from '@/stores/deck'

export type TextConditionType = 'contains_any' | 'contains_all' | 'excludes'

/** 条件ビルダーの 1 行。構造が正本で、正規表現はここから導かない */
export interface TextCondition {
  type: TextConditionType
  words: string[]
}

/** サーバー検索で投稿者を解決した結果 (アカウントごとに ID が違う) */
export interface AuthorResolution {
  id: string
  /** 表示用の `name@host`。移行直後は空で、表示のために一度だけ補う */
  acct: string
}

export interface SearchFilter {
  /** 投稿者 `name` または `name@host` */
  author?: string
  /**
   * サーバー検索の解決済み ID (accountId → 結果)。`null` = 未解決。
   * 表記が変わらない限り解決し直さない
   */
  authorIds?: Record<string, AuthorResolution | null>
  /** YYYY-MM-DD */
  since?: string
  until?: string
  /** true = 古い順。サーバー検索では取得済みページの並べ替え */
  ascending?: boolean
  /** 条件ビルダーの構造 (正本) */
  conditions?: TextCondition[]
  /** 外部から検索語を差し替えたとき、構造を消さずに効かない状態にする印 */
  conditionsPaused?: true
  /**
   * クライアント検索の範囲: `''` = 全アカウント、`server:<host>`、`account:<id>`
   */
  scope?: string
  /**
   * サーバー検索の範囲 = 返すノートのホスト: `''` = すべて、`.` = ローカル、
   * それ以外はホスト名
   */
  host?: string
  /** クライアント検索の添付。undefined = 問わない */
  hasFiles?: boolean
}

export type SearchFace = 'server' | 'client'

/** パネルの行。面が意味を持つ行だけ宣言し、パネル側に面の分岐を書かない */
export type SearchFilterRow =
  | 'scope'
  | 'host'
  | 'author'
  | 'period'
  | 'attachments'
  | 'conditions'

export const FACE_ROWS: Record<SearchFace, readonly SearchFilterRow[]> = {
  server: ['host', 'author', 'period', 'conditions'],
  client: ['scope', 'author', 'period', 'attachments', 'conditions'],
}

const ALL_ROWS: readonly SearchFilterRow[] = [
  'scope',
  'host',
  'author',
  'period',
  'attachments',
  'conditions',
]

export function rowHasValue(
  filter: SearchFilter | undefined,
  row: SearchFilterRow,
): boolean {
  if (!filter) return false
  switch (row) {
    case 'scope':
      return Boolean(filter.scope)
    case 'host':
      return Boolean(filter.host)
    case 'author':
      return Boolean(filter.author?.trim()) || hasAnyAuthorId(filter)
    case 'period':
      return Boolean(filter.since || filter.until)
    case 'attachments':
      return filter.hasFiles !== undefined
    case 'conditions':
      return (filter.conditions?.length ?? 0) > 0
  }
}

function hasAnyAuthorId(filter: SearchFilter): boolean {
  return Object.values(filter.authorIds ?? {}).some((r) => r !== null)
}

/** パネルの行が 1 つでも効いているか (漏斗の点灯)。並び順は含めない */
export function hasActiveFilter(filter: SearchFilter | undefined): boolean {
  return ALL_ROWS.some((row) => rowHasValue(filter, row))
}

/** 面に意味の無い行で値が残っているもの (見せて外せるようにする) */
export function staleRows(
  filter: SearchFilter | undefined,
  face: SearchFace,
): SearchFilterRow[] {
  const declared = new Set<SearchFilterRow>(FACE_ROWS[face])
  return ALL_ROWS.filter(
    (row) => !declared.has(row) && rowHasValue(filter, row),
  )
}

/** 1 行だけ消す。投稿者は解決済み ID も一緒に */
export function clearRow(
  filter: SearchFilter,
  row: SearchFilterRow,
): SearchFilter {
  const next = { ...filter }
  switch (row) {
    case 'scope':
      delete next.scope
      break
    case 'host':
      delete next.host
      break
    case 'author':
      delete next.author
      delete next.authorIds
      break
    case 'period':
      delete next.since
      delete next.until
      break
    case 'attachments':
      delete next.hasFiles
      break
    case 'conditions':
      delete next.conditions
      delete next.conditionsPaused
      break
  }
  return next
}

/** 「フィルターをクリア」: パネルの行だけ消し、並び順は残す */
export function clearPanelRows(filter: SearchFilter): SearchFilter {
  return ALL_ROWS.reduce<SearchFilter>((acc, row) => clearRow(acc, row), filter)
}

/** 条件ビルダーの語の入力をカンマ・読点・空白で割る */
export function parseConditionWords(input: string): string[] {
  return input
    .split(/[,、\s]+/) // i18n-ignore: data
    .map((w) => w.trim())
    .filter(Boolean)
}

/** 評価に使う本文の条件。一時停止中は空 */
export function effectiveConditions(
  filter: SearchFilter | undefined,
): TextCondition[] {
  if (!filter?.conditions || filter.conditionsPaused) return []
  return filter.conditions
}

interface NoteText {
  text: string | null
  cw: string | null
}

function bodyOf(note: NoteText): string | null {
  const parts = [note.cw, note.text].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  return parts.length > 0 ? parts.join('\n').toLowerCase() : null
}

/**
 * 本文の条件を手元で照合する (サーバー検索の後段)。大文字小文字を区別せず、
 * CW も本文として見る。本文の無いノートは「含む」では落ち「除外」では残る
 */
export function matchesTextConditions(
  note: NoteText,
  conditions: readonly TextCondition[],
): boolean {
  if (conditions.length === 0) return true
  const body = bodyOf(note)
  for (const cond of conditions) {
    const words = cond.words.map((w) => w.toLowerCase()).filter(Boolean)
    if (words.length === 0) continue
    switch (cond.type) {
      case 'contains_any':
        if (body === null || !words.some((w) => body.includes(w))) return false
        break
      case 'contains_all':
        if (body === null || !words.every((w) => body.includes(w))) return false
        break
      case 'excludes':
        if (body !== null && words.some((w) => body.includes(w))) return false
        break
    }
  }
  return true
}

/**
 * 検索語の後段照合。サーバーの検索はトークナイズで記号を落として曖昧に
 * 一致することがあるので、単一語はリテラル含有で絞る。空白区切りの複数語は
 * 解釈をサーバーに委ねて素通しする (今までの挙動のまま)
 */
export function matchesPlainTerm(note: NoteText, term: string): boolean {
  const q = term.trim()
  if (!q || /\s/.test(q)) return true
  const body = bodyOf(note)
  return body?.includes(q.toLowerCase()) ?? false
}

/**
 * 検索語の欄の入力以外 (ハッシュタグのクリック / CLI / AI) から検索語が
 * 差し替えられたときの条件: 期間と範囲を消し、本文の条件は消さずに止める。
 * 投稿者と並び順は残す
 */
export function externalQueryPatch(
  filter: SearchFilter | undefined,
): SearchFilter {
  if (!filter) return {}
  const next = { ...filter }
  delete next.since
  delete next.until
  delete next.scope
  delete next.host
  delete next.conditionsPaused
  if (next.conditions && next.conditions.length > 0) {
    next.conditionsPaused = true
  }
  return next
}

export interface ScopeAccount {
  id: string
  host: string
}

/** クライアント検索の範囲から検索対象のアカウント ID 列を決める。該当なしは空配列 */
export function resolveScopeAccounts(
  scope: string | undefined,
  accounts: readonly ScopeAccount[],
): string[] {
  if (!scope) return accounts.map((a) => a.id)
  if (scope.startsWith('server:')) {
    const host = scope.slice('server:'.length).toLowerCase()
    return accounts
      .filter((a) => a.host.toLowerCase() === host)
      .map((a) => a.id)
  }
  if (scope.startsWith('account:')) {
    const id = scope.slice('account:'.length)
    return accounts.some((a) => a.id === id) ? [id] : []
  }
  return accounts.map((a) => a.id)
}

/** 日付入力 (YYYY-MM-DD) を created_at 比較用の ISO 境界にする */
export function dateBounds(filter: SearchFilter): {
  since: string | null
  until: string | null
} {
  const since = filter.since
    ? new Date(`${filter.since}T00:00:00`).toISOString()
    : null
  const until = filter.until
    ? new Date(`${filter.until}T23:59:59.999`).toISOString()
    : null
  return { since, until }
}

export type ServerHostOption = 'all' | 'local' | 'host'

/** サーバーが公開する検索範囲の設定 (meta の該当項目だけ) */
export interface SearchScopeMeta {
  noteSearchableScope?: string | null
  federation?: string | null
}

/**
 * サーバー検索の範囲の選択肢。本家 Web と同じく、検索範囲が global で連合する
 * サーバーだけ「すべて / ホスト指定」を出す。設定を返さない (古い) サーバーと
 * 読めなかったサーバーはローカルだけ。これはサーバーが拒む境界ではなく、
 * 索引に無いものを探しに行かないための手元の出し分け
 */
export function serverHostOptions(
  meta: SearchScopeMeta | null | undefined,
): ServerHostOption[] {
  const scope = meta?.noteSearchableScope ?? 'local'
  const federates = meta?.federation !== 'none'
  if (scope === 'global' && federates) return ['all', 'local', 'host']
  return ['local']
}

/**
 * 検索 API に渡すホスト。空は渡さない。指定ホストが問い合わせ先のサーバー
 * 自身ならローカル (`.`) に読み替える (自分のホスト名で問い合わせると 0 件に
 * なり、検閲や故障に見えるため)
 */
export function effectiveHostParam(
  host: string | undefined,
  accountHost: string,
): string | undefined {
  if (!host) return undefined
  if (host === '.') return '.'
  return host.toLowerCase() === accountHost.toLowerCase() ? '.' : host
}

/** 投稿者の入力 `@name@host` / `name@host` / `name` を分ける。空は null */
export function parseAuthor(
  input: string,
): { username: string; host: string | null } | null {
  const a = input.trim().replace(/^@/, '')
  if (!a) return null
  const at = a.indexOf('@')
  if (at < 0) return { username: a, host: null }
  const username = a.slice(0, at)
  const host = a.slice(at + 1).toLowerCase()
  if (!username) return null
  return { username, host: host || null }
}

/** 旧 `clientSearchFilter` の形 (移行の読み取りにだけ使う) */
interface LegacyClientSearchFilter {
  scope?: string
  author?: string
  since?: string
  until?: string
  hasFiles?: boolean
  ascending?: boolean
}

type MigratableColumn = Pick<DeckColumn, 'id' | 'type'> &
  Partial<Pick<DeckColumn, 'accountId' | 'userId' | 'searchFilter'>> & {
    clientSearchFilter?: LegacyClientSearchFilter
  }

/**
 * 保存済みの条件を一度きり移行する: クライアント検索の `clientSearchFilter` と
 * サーバー検索の `userId` (「このユーザーのノートを検索」) を `searchFilter` へ。
 * 旧属性は消す (呼び出し側が書き戻して古い形を残さない)。移行済みと無関係な
 * カラムには触らない
 */
export function migrateSearchColumns<T extends MigratableColumn>(
  columns: T[],
): { columns: T[]; migrated: number } {
  let migrated = 0
  const out = columns.map((col) => {
    if (col.type === 'clientSearch' && col.clientSearchFilter) {
      const { clientSearchFilter, ...rest } = col
      migrated++
      const filter: SearchFilter = { ...rest.searchFilter }
      for (const key of [
        'scope',
        'author',
        'since',
        'until',
        'hasFiles',
        'ascending',
      ] as const) {
        const v = clientSearchFilter[key]
        if (v !== undefined && filter[key] === undefined) {
          ;(filter as Record<string, unknown>)[key] = v
        }
      }
      return { ...rest, searchFilter: filter } as T
    }
    if (col.type === 'search' && col.userId !== undefined) {
      const { userId, ...rest } = col
      migrated++
      if (!rest.accountId || !userId) return rest as T
      const filter: SearchFilter = {
        ...rest.searchFilter,
        authorIds: {
          ...rest.searchFilter?.authorIds,
          [rest.accountId]: { id: userId, acct: '' },
        },
      }
      return { ...rest, searchFilter: filter } as T
    }
    return col
  })
  return { columns: out, migrated }
}
