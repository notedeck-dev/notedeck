/**
 * AI に送る system prompt 末尾に注入する <notedeck-context> ブロックを組み立てる。
 *
 * - dataSources プリセット (ai.json5) で許可された項目のみを含める
 * - currentAccount / 任意のオブジェクトから credential 系フィールドを再帰的に除去
 * - 全項目 off の場合は空文字列を返す (空ブロックは出さない)
 *
 * Phase 1 では currentAccount / currentColumn / visibleNotes / recentConversation
 * の 4 種を扱う。visibleNotes / recentConversation は呼び出し側で取得して渡す。
 */

import type { Account } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { type AiConfig, resolveDataSources } from './useAiConfig'
import type { StoredMemo } from './useMemos'

/**
 * AI に送ってはいけないフィールド名 (credential / 機密データ)。
 * Misskey の認証トークンキー `i` を含む。Phase 3 の credential proxy 実行モデルでも
 * これらは AI に渡らないようにする。
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'token',
  'i',
  'accessToken',
  'refreshToken',
  'apiKey',
  'password',
  'secret',
])

/** 任意のオブジェクトから SENSITIVE_KEYS に一致するキーを再帰的に除去する。 */
export function stripCredentials<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((v) => stripCredentials(v)) as unknown as T
  }
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue
      out[k] = stripCredentials(v)
    }
    return out as T
  }
  return input
}

export interface AiContextInput {
  activeAccount: Account | null
  currentColumn: DeckColumn | null
  /** 既に projection 済みの可視ノート配列。空配列なら出力しない。 */
  visibleNotes?: unknown[]
  /** Phase 1 C5 で接続予定。未指定なら出力しない。 */
  recentConversation?: unknown[]
  /**
   * 既に projection 済みのローカルメモ (Zettelkasten 形式 markdown)。
   * 空配列 / undefined なら出力しない。
   */
  memos?: ProjectedMemo[]
  /**
   * accountId → host 引きのための accounts 一覧 (任意)。指定すると
   * `<currentColumn>` 内に `accountHost` を補強し、AI が「このカラムは
   * どのサーバーか」を即把握できる。
   */
  accounts?: readonly Account[]
  /**
   * セッションの persona (#491)。session.personaSkillId が指定された
   * チャットでこのフィールドが渡され、`<persona>` block が system prompt
   * 末尾の `<notedeck-context>` 内に注入される。AI は block の指示を読んで
   * `authorId='<id>'` で memos.create を呼ぶ。
   *
   * avatarUrl は AI に不要なので含めない (= UI 表示専用)。
   */
  persona?: {
    id: string
    displayName: string
    bio?: string
  }
}

/** AI に渡す可視ノートの上限件数。 */
export const MAX_VISIBLE_NOTES = 10

/** AI 送信時に context に含める直近会話の上限ターン数 (= 直近 N メッセージ)。 */
export const MAX_RECENT_TURNS = 20

/** AI 送信時に context に含めるローカルメモの上限件数 (updatedAt 降順 + 先頭切り出し)。 */
export const MAX_MEMOS = 20

/**
 * AI 送信用に可視 item を軽量化する projection。
 * カラム種別ごとに必要なフィールドだけ抽出する (循環参照と巨大 payload を回避)。
 * 未対応 / 不明な種別は最低限の id / name / type のみ抜き出す raw fallback。
 *
 * - timeline / list / antenna / mentions / channel / favorites / clip /
 *   user / specified / search / role / chat → ノート projection
 *   (text を `[CW: <reason>]` に置換、user.username 抽出)
 * - notifications → 通知 projection (type / userId / noteId / reaction)
 * - drive → ドライブファイル projection (name / type / size)
 * - その他 → raw fallback
 */
export type ProjectedItem = Record<string, unknown>

export interface ProjectedNote extends ProjectedItem {
  id: string
  userId?: string
  username?: string
  text?: string
  createdAt?: string
}

const NOTE_LIKE_COLUMN_TYPES: ReadonlySet<string> = new Set([
  'timeline',
  'list',
  'antenna',
  'mentions',
  'channel',
  'favorites',
  'clip',
  'user',
  'specified',
  'search',
  'role',
  'chat',
])

export function projectVisibleItems(
  items: unknown[] | undefined,
  columnType: string | undefined,
  limit = MAX_VISIBLE_NOTES,
): ProjectedItem[] {
  if (!items || items.length === 0) return []
  const projector = pickProjector(columnType)
  return items.slice(0, limit).map(projector)
}

function pickProjector(columnType?: string): (item: unknown) => ProjectedItem {
  if (columnType && NOTE_LIKE_COLUMN_TYPES.has(columnType)) {
    return projectOneNote
  }
  if (columnType === 'notifications') return projectOneNotification
  if (columnType === 'drive') return projectOneDriveItem
  return projectOneRaw
}

/**
 * column type から `<visibleXxx>` ブロックの XML タグ名を決定する。
 * AI が中身の種別をタグ名で即座に判別できる。
 */
export function pickVisibleBlockTag(columnType: string | undefined): string {
  if (columnType && NOTE_LIKE_COLUMN_TYPES.has(columnType))
    return 'visibleNotes'
  if (columnType === 'notifications') return 'visibleNotifications'
  if (columnType === 'drive') return 'visibleDriveItems'
  return 'visibleItems'
}

/**
 * @deprecated `projectVisibleItems(items, 'timeline')` を使用。
 * Phase 1 内部 API なので近いうちに削除予定。
 */
export function projectVisibleNotes(
  notes: unknown[] | undefined,
  limit = MAX_VISIBLE_NOTES,
): ProjectedNote[] {
  if (!notes || notes.length === 0) return []
  return notes.slice(0, limit).map(projectOneNote)
}

/**
 * 直近の会話履歴を <recentConversation> 用に射影する。
 * 現セッションの history は API の messages としても渡るが、ここでは AI が
 * テキストとして「直近やり取り」を参照できるよう別形式でも提供する。
 * dataSource.recentConversation = false の場合は呼び出し側でこの関数を
 * 通さなければそもそも何も渡らない (= 過去会話を context に出さない)。
 */
export interface ProjectedTurn {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export function projectRecentConversation(
  messages: { role: string; content: string }[] | undefined,
  limit = MAX_RECENT_TURNS,
): ProjectedTurn[] {
  if (!messages || messages.length === 0) return []
  const tail = messages.slice(-limit)
  const out: ProjectedTurn[] = []
  for (const m of tail) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') {
      continue
    }
    out.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    })
  }
  return out
}

/**
 * ローカルメモを <memos> ブロックに渡せる形へ投影する。
 *
 * メモは Zettelkasten 形式の永続 markdown ファイルで、PKM 用途。本文 (`text`) と
 * id / 更新時刻だけ抜き、draft 専用フィールド (cw / visibility / fileIds /
 * pollChoices / scheduledAt 等) は AI に渡さない (AI 側で本質的に不要 + 機密性も
 * 低減)。createdAt は memoKey 自体が `YYYYMMDDHHmmss` 形式の Zettelkasten id =
 * 作成時刻なので、AI は id から推測できる (= 別フィールドとして渡す必要なし)。
 *
 * - updatedAt 降順ソート (新しいメモが上)
 * - limit (default {@link MAX_MEMOS}) で先頭切り出し
 *
 * 入力は `useMemos.ts` の `loadAllMemos(accountId)` の戻り値 `StoredMemos`
 * (= Record<memoKey, StoredMemo>) を `Object.entries` で展開した形。
 */
export interface ProjectedMemo {
  id: string
  text: string
  updatedAt: string
}

export type MemoEntry = readonly [memoKey: string, memo: StoredMemo]

export function projectMemos(
  entries: readonly MemoEntry[] | undefined,
  limit = MAX_MEMOS,
): ProjectedMemo[] {
  if (!entries || entries.length === 0) return []
  const sorted = [...entries].sort(([, a], [, b]) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  )
  return sorted.slice(0, limit).map(([memoKey, memo]) => ({
    id: memoKey,
    text: memo.data.text,
    updatedAt: memo.updatedAt,
  }))
}

function projectOneNote(n: unknown): ProjectedNote {
  if (!n || typeof n !== 'object') return { id: 'unknown' }
  const o = n as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : 'unknown'
  const userId = typeof o.userId === 'string' ? o.userId : undefined
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : undefined
  const cw = typeof o.cw === 'string' && o.cw.length > 0 ? o.cw : null
  const username =
    o.user && typeof o.user === 'object'
      ? typeof (o.user as Record<string, unknown>).username === 'string'
        ? ((o.user as Record<string, unknown>).username as string)
        : undefined
      : undefined
  const text =
    cw != null ? `[CW: ${cw}]` : typeof o.text === 'string' ? o.text : undefined
  return { id, userId, username, text, createdAt }
}

function projectOneNotification(n: unknown): ProjectedItem {
  if (!n || typeof n !== 'object')
    return { kind: 'notification', id: 'unknown' }
  const o = n as Record<string, unknown>
  const out: ProjectedItem = { kind: 'notification' }
  out.id = typeof o.id === 'string' ? o.id : 'unknown'
  if (typeof o.type === 'string') out.type = o.type
  if (typeof o.userId === 'string') out.userId = o.userId
  if (typeof o.noteId === 'string') out.noteId = o.noteId
  if (typeof o.reaction === 'string') out.reaction = o.reaction
  if (typeof o.createdAt === 'string') out.createdAt = o.createdAt
  // 内部に user/note を持つ場合は username/text のみ拾う (stripCredentials も後段で適用)
  if (o.user && typeof o.user === 'object') {
    const u = o.user as Record<string, unknown>
    if (typeof u.username === 'string') out.username = u.username
  }
  if (o.note && typeof o.note === 'object') {
    const note = o.note as Record<string, unknown>
    const cw =
      typeof note.cw === 'string' && note.cw.length > 0 ? note.cw : null
    if (cw != null) out.noteText = `[CW: ${cw}]`
    else if (typeof note.text === 'string') out.noteText = note.text
  }
  return out
}

function projectOneDriveItem(n: unknown): ProjectedItem {
  if (!n || typeof n !== 'object') return { kind: 'driveItem', id: 'unknown' }
  const o = n as Record<string, unknown>
  const out: ProjectedItem = { kind: 'driveItem' }
  out.id = typeof o.id === 'string' ? o.id : 'unknown'
  if (typeof o.name === 'string') out.name = o.name
  if (typeof o.type === 'string') out.type = o.type
  if (typeof o.size === 'number') out.size = o.size
  if (typeof o.createdAt === 'string') out.createdAt = o.createdAt
  if (typeof o.comment === 'string') out.comment = o.comment
  return out
}

function projectOneRaw(n: unknown): ProjectedItem {
  if (!n || typeof n !== 'object') return { id: 'unknown' }
  const o = n as Record<string, unknown>
  const out: ProjectedItem = {}
  if (typeof o.id === 'string') out.id = o.id
  if (typeof o.name === 'string') out.name = o.name
  if (typeof o.type === 'string') out.type = o.type
  if (typeof o.createdAt === 'string') out.createdAt = o.createdAt
  return out
}

function jsonBlock(obj: unknown): string {
  return JSON.stringify(stripCredentials(obj), null, 2)
}

/**
 * column.accountId が accounts のどれか一致したら `accountHost` を加えて返す。
 * AI が `<currentColumn>` を見るだけで「これは misskey.io のカラム」と即理解
 * できるようにするための補強。
 */
function enrichColumnWithHost(
  column: DeckColumn,
  accounts: readonly Account[] | undefined,
): DeckColumn & { accountHost?: string } {
  if (!accounts || !column.accountId) return column
  const acc = accounts.find((a) => a.id === column.accountId)
  if (!acc) return column
  return { ...column, accountHost: acc.host }
}

/**
 * dataSources 設定と context 入力から `<notedeck-context>` XML ブロックを組む。
 * 何も入らない場合は空文字列を返す (skills prompt との結合で no-op になる)。
 */
export function buildAiContextBlock(
  config: AiConfig,
  ctx: AiContextInput,
): string {
  const ds = resolveDataSources(config.dataSources)
  const parts: string[] = []

  if (ds.currentAccount && ctx.activeAccount) {
    parts.push(
      `  <currentAccount>\n${jsonBlock(ctx.activeAccount)}\n  </currentAccount>`,
    )
  }
  if (ds.currentColumn && ctx.currentColumn) {
    const enriched = enrichColumnWithHost(ctx.currentColumn, ctx.accounts)
    parts.push(`  <currentColumn>\n${jsonBlock(enriched)}\n  </currentColumn>`)
  }
  if (ds.visibleNotes && ctx.visibleNotes && ctx.visibleNotes.length > 0) {
    const tag = pickVisibleBlockTag(ctx.currentColumn?.type)
    parts.push(`  <${tag}>\n${jsonBlock(ctx.visibleNotes)}\n  </${tag}>`)
  }
  if (
    ds.recentConversation &&
    ctx.recentConversation &&
    ctx.recentConversation.length > 0
  ) {
    parts.push(
      `  <recentConversation>\n${jsonBlock(ctx.recentConversation)}\n  </recentConversation>`,
    )
  }
  if (ds.memos && ctx.memos && ctx.memos.length > 0) {
    parts.push(`  <memos>\n${jsonBlock(ctx.memos)}\n  </memos>`)
  }
  // persona block (#491) — session.personaSkillId 由来。dataSources で
  // on/off せず、session 自身が persona を持っていれば常に注入する。
  // block + instruction を一体型 prose で書き、AI が役割を確実に把握できる
  // ようにする (memos.create の authorId 規約も同 block 内で示す)。
  if (ctx.persona) {
    const lines: string[] = ['  <persona>']
    lines.push(
      `    あなたは ${ctx.persona.displayName} (id: ${ctx.persona.id}) として振る舞う。`,
    )
    lines.push(
      `    memos.create / memos.update を呼ぶ際は authorId='${ctx.persona.id}' を指定する。`,
    )
    if (ctx.persona.bio) {
      lines.push(`    bio: ${ctx.persona.bio}`)
    }
    lines.push('  </persona>')
    parts.push(lines.join('\n'))
  }

  if (parts.length === 0) return ''
  return `<notedeck-context>\n${parts.join('\n')}\n</notedeck-context>`
}

/**
 * skills 由来の system prompt と <notedeck-context> ブロックを連結する。
 * どちらも空なら undefined を返す (= system prompt なしで API を呼ぶ既存挙動)。
 */
export function joinSystemPrompt(
  skillsPrompt: string,
  contextBlock: string,
): string | undefined {
  if (skillsPrompt && contextBlock) {
    return `${skillsPrompt}\n\n${contextBlock}`
  }
  return skillsPrompt || contextBlock || undefined
}

/**
 * HEARTBEAT (#411) 専用の context ブロック。cheap check 結果を AI に渡し、
 * 「unread が 5 件あるから notifications.list で詳細を見て」という導線を作る。
 *
 * cheapResults は preset id → hit count。空 / 全 0 の場合は空文字を返す
 * (= heartbeat-context ブロック自体出さない)。
 */
export function buildHeartbeatContextBlock(
  cheapResults: Record<string, number>,
  triggeredAtIso?: string,
): string {
  const entries = Object.entries(cheapResults).filter(([_, n]) => n > 0)
  if (entries.length === 0) return ''
  const lines: string[] = []
  if (triggeredAtIso) {
    lines.push(`  <triggeredAt>${triggeredAtIso}</triggeredAt>`)
  }
  lines.push('  <cheapCheckResults>')
  for (const [preset, count] of entries) {
    lines.push(`    <${preset}>${count}</${preset}>`)
  }
  lines.push('  </cheapCheckResults>')
  return `<heartbeat-context>\n${lines.join('\n')}\n</heartbeat-context>`
}

/**
 * skills + notedeck-context + heartbeat-context + heartbeat instruction を
 * 1 本の system prompt に連結する。empty を空文字に置き換えて結合するので、
 * どれか欠けてもクリーンに動作する。
 */
export function composeHeartbeatSystemPrompt(
  skillsPrompt: string,
  notedeckContext: string,
  heartbeatContext: string,
  instruction: string,
): string {
  return [skillsPrompt, notedeckContext, heartbeatContext, instruction]
    .filter((s) => s && s.length > 0)
    .join('\n\n')
}
