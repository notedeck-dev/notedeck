import yaml from 'js-yaml'
import { ref } from 'vue'
import type { NoteVisibility } from '@/adapters/types'
import { emitNoteDeckEvent } from '@/aiscript/events'
import { type EditAttribution, pushSnapshot } from '@/utils/historyFs'
import {
  deleteHistorySidecar,
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
   * 誰が書いたか (#493、#1018 で principal 種別へ)。Git commit の Author
   * header と同型の document intrinsic property。cache ではなく memo 自体の
   * 真のデータなので、参照先が後で消えても表示は壊れない (= immutable)。
   *
   * メモはアカウントに紐づかないので、ここに入るのは「どのアカウントで
   * 書いたか」ではなく「人間か、AI か、HEARTBEAT か、プラグインか、外部
   * アプリか」という principal 種別 (#712)。
   *
   * - `id`: `user` / `ai.chat` / `ai.heartbeat` / `external` /
   *   `plugin:<id>` / `skill:<persona-id>` (AI のどの人格かは principal の
   *   下位の詳細)
   * - `displayName` / `avatarUrl`: 作成時に snapshot された表示用情報
   *
   * 未指定 = 人間が書いた (= `user` と同義。既定なので省略される)。
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

/** True if `memoKey` is already present in the cache. */
function memoKeyExists(memoKey: string): boolean {
  return memoKey in cache
}

// --- In-memory cache ---

/**
 * メモはアカウントに紐づかない (#1018)。サーバーに送らずローカルで完結する
 * もので、アカウントに紐づかない AI カラムからも参照される。所有者は持たず、
 * 「誰が書いたか」は principal 種別 (`MemoData.author`) だけで表す。
 */
let cache: StoredMemos = {}
/** Per-memo createdAt, kept alongside the cache so re-saves preserve it. */
const createdAtCache: Record<string, string> = {}
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

function toFrontmatterSource(
  memoKey: string,
  stored: StoredMemo,
  createdAt: string,
): string {
  const d = stored.data
  const frontmatter: Record<string, unknown> = { id: memoKey }
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
  stored: StoredMemo
  createdAt: string
} {
  const parsed = splitFrontmatter(fileContent)
  const fm = parsed.data
  const updatedAt =
    typeof fm.updatedAt === 'string' ? fm.updatedAt : new Date().toISOString()
  const createdAt = typeof fm.createdAt === 'string' ? fm.createdAt : updatedAt
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

  return { stored: { updatedAt, data }, createdAt }
}

// --- Loading ---

export async function ensureMemosLoaded(): Promise<void> {
  if (loaded) return
  if (!isTauri) {
    loaded = true
    return
  }

  const files = await listMemoFiles()
  const next: StoredMemos = {}
  for (const filename of files) {
    const memoKey = memoKeyFromFilename(filename)
    if (!memoKey) continue
    try {
      const content = await readMemoFile(filename)
      if (!content) continue
      const { stored, createdAt } = parseMemoContent(content)
      next[memoKey] = stored
      createdAtCache[memoKey] = createdAt
    } catch {
      // Skip unreadable/corrupt files but keep loading the rest
    }
  }
  cache = next
  loaded = true
}

/** 全メモ (#1018)。アカウントによる区分けは無い。 */
export function loadAllMemos(): StoredMemos {
  return cache
}

export function loadMemo(memoKey: string): StoredMemo | null {
  return cache[memoKey] ?? null
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
    const stored = cache[memoKey]
    if (!stored) return
    const createdAt = createdAtCache[memoKey] ?? stored.updatedAt
    const content = toFrontmatterSource(memoKey, stored, createdAt)
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

/**
 * メモを保存する。誰が書いたかは `data.author` (principal 種別) が持つ。
 * 未設定 = 人間が書いた。
 */
export function saveMemo(
  memoKey: string,
  data: MemoData,
  attribution?: EditAttribution,
): StoredMemo {
  const stored: StoredMemo = { updatedAt: new Date().toISOString(), data }
  const isNew = !(memoKey in cache)
  // 編集前 snapshot を history sidecar に push (fire-and-forget)。
  // 他のテキスト (スキル・ウィジット・テーマ・CSS) と同じ扱い。内容が同じ
  // 保存では積まない — 自動保存でリングを使い潰さないため
  const prev = cache[memoKey]?.data.text
  if (prev !== undefined && prev !== data.text) {
    pushSnapshot('memo', memoKey, { body: prev }, attribution).catch((e) =>
      console.warn('[useMemos] history push failed:', e),
    )
  }
  cache = { ...cache, [memoKey]: stored }
  if (!createdAtCache[memoKey]) createdAtCache[memoKey] = stored.updatedAt
  schedulePersist(memoKey)
  memosVersion.value++
  emitNoteDeckEvent(isNew ? 'memo:created' : 'memo:updated', { memoKey })
  return stored
}

export function deleteMemo(memoKey: string): void {
  if (!(memoKey in cache)) return
  const next = { ...cache }
  delete next[memoKey]
  cache = next
  delete createdAtCache[memoKey]
  cancelPendingWrite(memoKey)
  if (isTauri) {
    void deleteMemoFile(memoFilename(memoKey))
    // 履歴サイドカーも一緒に消す。残すと、同じ Zettelkasten ID で作り直した
    // メモが前のメモの履歴を引き継ぐ (他の配布物は sidecarFileCollection が
    // 主ファイルと一緒に消している)
    void deleteHistorySidecar('memo', memoKey)
  }
  memosVersion.value++
  emitNoteDeckEvent('memo:deleted', { memoKey })
}
