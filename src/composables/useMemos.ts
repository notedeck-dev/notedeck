import yaml from 'js-yaml'
import { ref } from 'vue'
import type { NoteVisibility } from '@/adapters/types'
import { useAccountsStore } from '@/stores/accounts'
import {
  deleteMemoFile,
  isTauri,
  listMemoFiles,
  readMemoFile,
  writeMemoFile,
} from '@/utils/settingsFs'

export interface MemoData {
  text: string
  cw: string
  showCw: boolean
  visibility: NoteVisibility
  localOnly: boolean
  fileIds: string[]
  pollChoices: string[]
  pollMultiple: boolean
  showPoll: boolean
  scheduledAt: string | null
  /**
   * 自由記述タグ (#492)。NoteDeck は値を enumerate しない (= ユーザー / AI が
   * 任意の string を付ける)。memo の分類 / フィルタ用途。
   * dataSources の `memosConfig.excludeTags` で AI 注入から除外する tag を
   * 設定可能。default: `[]`。
   */
  tags: string[]
  /**
   * 著者の埋め込みメタデータ (#493)。Git commit の Author header / Misskey
   * note の user フィールドと同型の document intrinsic property。
   * cache ではなく memo 自体の真のデータなので、参照先 (skill / account)
   * が後で消えても表示は壊れない (= immutable)。
   *
   * - `id`: Identity ID (`skill:<persona-id>` or accountId)
   * - `displayName` / `avatarUrl`: 作成時に snapshot された表示用情報
   *
   * 未指定 = ユーザー本人 (= accountId にフォールバック表示)。
   */
  author?: {
    id: string
    displayName: string
    avatarUrl?: string
  }
}

export interface StoredMemo {
  updatedAt: string
  data: MemoData
}

export type StoredMemos = Record<string, StoredMemo>

/** accountId → memos keyed by memoKey. */
type MemosFile = Record<string, StoredMemos>

const VALID_VISIBILITIES: ReadonlyArray<NoteVisibility> = [
  'public',
  'home',
  'followers',
  'specified',
]

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatZettelkastenId(d: Date): string {
  return (
    `${d.getFullYear()}` +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  )
}

/**
 * Zettelkasten-style unique ID: `YYYYMMDDHHmmss` (local time).
 * Collisions are avoided by probing the in-memory cache and advancing by
 * one second until an unused id is found.
 */
export function generateMemoKey(): string {
  const now = new Date()
  let base = formatZettelkastenId(now)
  let attempt = 0
  while (memoKeyExists(base)) {
    attempt++
    const bumped = new Date(now.getTime() + attempt * 1000)
    base = formatZettelkastenId(bumped)
  }
  return base
}

function memoFilename(memoKey: string): string {
  return `${memoKey}.md`
}

function memoKeyFromFilename(name: string): string | null {
  if (!name.endsWith('.md')) return null
  return name.slice(0, -3)
}

/** True if `memoKey` is already present in any account bucket of the cache. */
function memoKeyExists(memoKey: string): boolean {
  for (const bucket of Object.values(cache)) {
    if (memoKey in bucket) return true
  }
  return false
}

// --- In-memory cache ---

let cache: MemosFile = {}
/** Per-memo createdAt, kept alongside the cache so re-saves preserve it. */
const createdAtCache: Record<string, string> = {}
/**
 * Per-memo accountId (denormalised into frontmatter). Needed on re-save
 * because the caller no longer passes accountId once the form is open
 * against a stored memo.
 */
const accountIdByKey: Record<string, string> = {}
let loaded = false

export const memosVersion = ref(0)

// --- Frontmatter ⇔ StoredMemo ---

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function splitFrontmatter(raw: string): {
  data: Record<string, unknown>
  body: string
} {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { data: {}, body: raw }
  let data: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(match[1] ?? '')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Keep data = {} on parse failure
  }
  return { data, body: match[2] ?? '' }
}

function buildMemoSource(
  body: string,
  frontmatter: Record<string, unknown>,
): string {
  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' })
  return `---\n${yamlStr}---\n\n${body}\n`
}

/**
 * Human-readable `@username@host` for the frontmatter, read lazily from the
 * accounts store so a rename propagates to new saves. Purely for external
 * readers (Obsidian/AI); accountId remains the source of truth on load.
 */
function resolveAuthor(accountId: string): string | null {
  try {
    const store = useAccountsStore()
    const account = store.accounts.find((a) => a.id === accountId)
    if (!account) return null
    return `@${account.username}@${account.host}`
  } catch {
    return null
  }
}

function toFrontmatterSource(
  memoKey: string,
  accountId: string,
  stored: StoredMemo,
  createdAt: string,
): string {
  const d = stored.data
  const frontmatter: Record<string, unknown> = {
    id: memoKey,
    accountId,
  }
  const author = resolveAuthor(accountId)
  if (author) frontmatter.author = author
  frontmatter.createdAt = createdAt
  frontmatter.updatedAt = stored.updatedAt

  // Optional fields — only emit when non-default to keep the frontmatter
  // readable in Obsidian/LLM contexts.
  if (d.visibility !== 'public') frontmatter.visibility = d.visibility
  if (d.cw.trim()) {
    frontmatter.cw = d.cw
    if (d.showCw) frontmatter.showCw = true
  }
  if (d.localOnly) frontmatter.localOnly = true
  if (d.fileIds.length > 0) frontmatter.fileIds = d.fileIds
  if (d.showPoll) {
    frontmatter.showPoll = true
    frontmatter.pollChoices = d.pollChoices
    if (d.pollMultiple) frontmatter.pollMultiple = true
  }
  if (d.scheduledAt) frontmatter.scheduledAt = d.scheduledAt
  if (d.tags.length > 0) frontmatter.tags = d.tags
  if (d.author) {
    const authorBlock: Record<string, unknown> = {
      id: d.author.id,
      displayName: d.author.displayName,
    }
    if (d.author.avatarUrl) authorBlock.avatarUrl = d.author.avatarUrl
    frontmatter.author = authorBlock
  }

  return buildMemoSource(d.text, frontmatter)
}

function parseAuthorBlock(raw: unknown): MemoData['author'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  const displayName = typeof r.displayName === 'string' ? r.displayName : ''
  if (!id || !displayName) return undefined
  const avatarUrl = typeof r.avatarUrl === 'string' ? r.avatarUrl : undefined
  return avatarUrl ? { id, displayName, avatarUrl } : { id, displayName }
}

function parseMemoContent(fileContent: string): {
  accountId: string | null
  stored: StoredMemo
  createdAt: string
} {
  const parsed = splitFrontmatter(fileContent)
  const fm = parsed.data
  const updatedAt =
    typeof fm.updatedAt === 'string' ? fm.updatedAt : new Date().toISOString()
  const createdAt = typeof fm.createdAt === 'string' ? fm.createdAt : updatedAt
  const accountId = typeof fm.accountId === 'string' ? fm.accountId : null

  const visibility: NoteVisibility = VALID_VISIBILITIES.includes(
    fm.visibility as NoteVisibility,
  )
    ? (fm.visibility as NoteVisibility)
    : 'public'

  const data: MemoData = {
    text: parsed.body.replace(/^\n/, ''),
    cw: typeof fm.cw === 'string' ? fm.cw : '',
    showCw: fm.showCw === true,
    visibility,
    localOnly: fm.localOnly === true,
    fileIds: Array.isArray(fm.fileIds)
      ? fm.fileIds.filter((x): x is string => typeof x === 'string')
      : [],
    pollChoices: Array.isArray(fm.pollChoices)
      ? fm.pollChoices.filter((x): x is string => typeof x === 'string')
      : [],
    pollMultiple: fm.pollMultiple === true,
    showPoll: fm.showPoll === true,
    scheduledAt: typeof fm.scheduledAt === 'string' ? fm.scheduledAt : null,
    tags: Array.isArray(fm.tags)
      ? fm.tags.filter((x): x is string => typeof x === 'string')
      : [],
    author: parseAuthorBlock(fm.author),
  }

  return { accountId, stored: { updatedAt, data }, createdAt }
}

// --- Loading ---

export async function ensureMemosLoaded(): Promise<void> {
  if (loaded) return
  if (!isTauri) {
    loaded = true
    return
  }

  const files = await listMemoFiles()
  const next: MemosFile = {}
  for (const filename of files) {
    const memoKey = memoKeyFromFilename(filename)
    if (!memoKey) continue
    try {
      const content = await readMemoFile(filename)
      if (!content) continue
      const { accountId, stored, createdAt } = parseMemoContent(content)
      if (!accountId) continue // Skip memos without an owner — treat as orphan
      const bucket = next[accountId] ?? {}
      bucket[memoKey] = stored
      next[accountId] = bucket
      createdAtCache[memoKey] = createdAt
      accountIdByKey[memoKey] = accountId
    } catch {
      // Skip unreadable/corrupt files but keep loading the rest
    }
  }
  cache = next
  loaded = true
}

export function loadAllMemos(accountId: string): StoredMemos {
  return cache[accountId] ?? {}
}

export interface CrossAccountMemoEntry {
  accountId: string
  memoKey: string
  memo: StoredMemo
}

/**
 * Flatten all memos across all accounts. Used by cross-account memo column
 * to merge per-account buckets into a single timeline-style view. Caller is
 * responsible for sorting (by `memo.updatedAt` descending in the typical case).
 */
export function loadAllMemosCrossAccount(): CrossAccountMemoEntry[] {
  const out: CrossAccountMemoEntry[] = []
  for (const [accountId, bucket] of Object.entries(cache)) {
    for (const [memoKey, memo] of Object.entries(bucket)) {
      out.push({ accountId, memoKey, memo })
    }
  }
  return out
}

export function loadMemo(
  accountId: string,
  memoKey: string,
): StoredMemo | null {
  return loadAllMemos(accountId)[memoKey] ?? null
}

// --- Per-memo debounced writes ---

const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const WRITE_DEBOUNCE_MS = 300

function schedulePersist(memoKey: string): void {
  if (!isTauri) return
  const existingTimer = writeTimers.get(memoKey)
  if (existingTimer) clearTimeout(existingTimer)
  const timer = setTimeout(() => {
    writeTimers.delete(memoKey)
    const accountId = accountIdByKey[memoKey]
    if (!accountId) return
    const stored = cache[accountId]?.[memoKey]
    if (!stored) return
    const createdAt = createdAtCache[memoKey] ?? stored.updatedAt
    const content = toFrontmatterSource(memoKey, accountId, stored, createdAt)
    writeMemoFile(memoFilename(memoKey), content).catch((e) => {
      console.error(`[useMemos] Failed to persist ${memoKey}:`, e)
    })
  }, WRITE_DEBOUNCE_MS)
  writeTimers.set(memoKey, timer)
}

function cancelPendingWrite(memoKey: string): void {
  const timer = writeTimers.get(memoKey)
  if (timer) {
    clearTimeout(timer)
    writeTimers.delete(memoKey)
  }
}

// --- Mutations ---

export function saveMemo(
  accountId: string,
  memoKey: string,
  data: MemoData,
): StoredMemo {
  const stored: StoredMemo = { updatedAt: new Date().toISOString(), data }
  const existing = cache[accountId] ?? {}
  cache = {
    ...cache,
    [accountId]: { ...existing, [memoKey]: stored },
  }
  if (!createdAtCache[memoKey]) createdAtCache[memoKey] = stored.updatedAt
  accountIdByKey[memoKey] = accountId
  schedulePersist(memoKey)
  memosVersion.value++
  return stored
}

export function deleteMemo(accountId: string, memoKey: string): void {
  const existing = cache[accountId]
  if (!existing || !(memoKey in existing)) return
  const next = { ...existing }
  delete next[memoKey]
  cache = { ...cache, [accountId]: next }
  delete createdAtCache[memoKey]
  delete accountIdByKey[memoKey]
  cancelPendingWrite(memoKey)
  if (isTauri) {
    void deleteMemoFile(memoFilename(memoKey))
  }
  memosVersion.value++
}

export function deleteAllMemos(accountId: string): void {
  const existing = cache[accountId]
  if (!existing) return
  const memoKeys = Object.keys(existing)
  for (const memoKey of memoKeys) {
    delete createdAtCache[memoKey]
    delete accountIdByKey[memoKey]
    cancelPendingWrite(memoKey)
    if (isTauri) {
      void deleteMemoFile(memoFilename(memoKey))
    }
  }
  cache = { ...cache, [accountId]: {} }
  memosVersion.value++
}
