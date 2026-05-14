/**
 * useAiSessionsStore — AI セッション (`sessions/<id>.json5`) の集中管理。
 *
 * - **メタは全件常駐**: 数百件規模なら最大数 MB なので問題なし
 * - **本文 (messages) は遅延ロード**: セッション切替時に必要なものだけ
 * - **永続化は sessionId 単位 debounce**: 複数カラムから同じセッションを開いても
 *   ファイル書込は 1 ファイルに集約される
 * - **id (= ファイル名 stem) と内部 id は完全一致**: ファイル単体で自己同定可能
 *
 * カラム側からは `useAiConversation(sessionId)` 経由でアクセスし、本ストアの
 * リアクティブ参照と同期する（本ストアは単一の真の source）。
 */

import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage } from '@/composables/useAiChat'
import { generateSessionId } from '@/utils/aiSessionId'
import {
  aiSessionFilename,
  deleteAiSessionFile,
  isTauri,
  listAiSessionFiles,
  readAiSessionFile,
  writeAiSessionFile,
} from '@/utils/settingsFs'

const PERSIST_DEBOUNCE_MS = 500
const CURRENT_SCHEMA_VERSION = 1

export type AiSessionKind = 'chat' | 'command' | 'task' | 'heartbeat'

/** セッション一覧 (ドロワー) で使う軽量メタ。 */
export interface AiSessionMeta {
  id: string
  kind: AiSessionKind
  title: string
  model: string
  /** 使用する Vault 接続の id (#564)。旧 session は空文字。 */
  connectionId: string
  createdAt: number
  updatedAt: number
  messageCount: number
  /** 最後のメッセージ本文プレビュー (drawer 表示用、120 文字 trim)。空可。 */
  lastMessagePreview: string
  /**
   * このセッションが作成された時点の persona skill id (#491、snapshot)。
   * `aiConfig.personaSkillId` (= 新規セッションのデフォルト) と独立に session
   * 自身が値を保持するため、後でグローバル設定を変えても過去セッションの
   * persona 表示は固定されたまま (Git commit の Author header と同じ
   * immutable semantic)。空文字 / 未指定 = persona なしで作成された session。
   */
  personaSkillId?: string
}

/** メタ + 本文。chat 以外の kind が増えたら discriminated union 化する。 */
export interface AiSession extends AiSessionMeta {
  schemaVersion: number
  messages: ChatMessage[]
  /** 知らないフィールドは forward-compat で保持して書き戻す。 */
  unknownFields?: Record<string, unknown>
}

interface PersistShape {
  schemaVersion: number
  id: string
  kind: AiSessionKind
  title: string
  model: string
  connectionId: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  [key: string]: unknown
}

const KNOWN_FIELDS = new Set([
  'schemaVersion',
  'id',
  'kind',
  'title',
  'model',
  'connectionId',
  'createdAt',
  'updatedAt',
  'messages',
  'personaSkillId',
])

function serialize(session: AiSession): string {
  const out: Record<string, unknown> = {
    schemaVersion: session.schemaVersion,
    id: session.id,
    kind: session.kind,
    title: session.title,
    model: session.model,
    connectionId: session.connectionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages,
  }
  if (session.personaSkillId) out.personaSkillId = session.personaSkillId
  if (session.unknownFields) {
    for (const [k, v] of Object.entries(session.unknownFields)) {
      out[k] = v
    }
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

function deserialize(raw: string): AiSession | null {
  let parsed: unknown
  try {
    parsed = JSON5.parse(raw)
  } catch (e) {
    console.warn('[ai-sessions] parse failed:', e)
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as PersistShape
  const messages = Array.isArray(r.messages) ? r.messages : []
  const unknownFields: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) {
    if (!KNOWN_FIELDS.has(k)) unknownFields[k] = v
  }
  return {
    schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : 1,
    id: typeof r.id === 'string' ? r.id : '',
    kind: (r.kind as AiSessionKind) || 'chat',
    title: typeof r.title === 'string' ? r.title : '',
    model: typeof r.model === 'string' ? r.model : '',
    connectionId: typeof r.connectionId === 'string' ? r.connectionId : '',
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    messages,
    messageCount: messages.length,
    // drawer 表示用 preview は listSorted() 側で computed する。AiSession 自体には
    // 永続化せず、空文字を入れて型を満たす。
    lastMessagePreview: '',
    personaSkillId:
      typeof r.personaSkillId === 'string' && r.personaSkillId
        ? r.personaSkillId
        : undefined,
    unknownFields:
      Object.keys(unknownFields).length > 0 ? unknownFields : undefined,
  }
}

export const useAiSessionsStore = defineStore('aiSessions', () => {
  /** セッション本体 (メタ + 本文) のキャッシュ。id をキーとする。 */
  const sessions = ref<Map<string, AiSession>>(new Map())
  /** メタ全件 list 済みフラグ。`loadAllMeta()` で立てる。 */
  const metaLoaded = ref(false)

  /** sessionId 単位の debounce タイマー。 */
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * 全セッションのメタ + 本文を一括ロード。typical 数百件なら数 MB なので
   * 常駐させて問題ない。失敗ファイルはスキップしつつ進める。
   */
  async function loadAllMeta(): Promise<void> {
    if (metaLoaded.value) return
    if (!isTauri) {
      metaLoaded.value = true
      return
    }
    try {
      const files = await listAiSessionFiles()
      for (const file of files) {
        try {
          const raw = await readAiSessionFile(file)
          const session = deserialize(raw)
          if (session?.id) {
            sessions.value.set(session.id, session)
          }
        } catch (e) {
          console.warn(`[ai-sessions] load ${file} failed:`, e)
        }
      }
    } catch (e) {
      console.warn('[ai-sessions] listAiSessionFiles failed:', e)
    }
    // ref<Map> は in-place mutation 後に再代入で reactivity を発火
    sessions.value = new Map(sessions.value)
    metaLoaded.value = true
  }

  function get(id: string): AiSession | undefined {
    return sessions.value.get(id)
  }

  /**
   * 最後のメッセージから drawer 用 preview 文字列を作る。複数行 / 過剰な
   * 空白は 1 行に潰し、120 字で trim。tool_use 行は内容が技術的なので skip。
   */
  function buildLastMessagePreview(messages: ChatMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m) continue
      // tool 結果 / tool 呼び出し行はユーザー視点の preview として有用でない
      if (m.toolResultFor || m.toolUseId) continue
      const text = (m.content ?? '').trim()
      if (text.length === 0) continue
      const flat = text.replace(/\s+/g, ' ').trim()
      return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
    }
    return ''
  }

  /** 並べ替え済みメタリスト (updatedAt 降順)。ドロワーが購読する。 */
  function listSorted(): AiSessionMeta[] {
    const arr = Array.from(sessions.value.values()).map<AiSessionMeta>((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      model: s.model,
      connectionId: s.connectionId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      lastMessagePreview: buildLastMessagePreview(s.messages),
      personaSkillId: s.personaSkillId,
    }))
    arr.sort((a, b) => b.updatedAt - a.updatedAt)
    return arr
  }

  /**
   * 新規セッションを生成してキャッシュに登録。ファイル書込は最初の
   * `updateMessages()` または `setTitle()` 呼び出し時に走る。
   *
   * `personaSkillId` を渡すと session に snapshot 保存される (#491)。
   * 呼出側は `aiConfig.personaSkillId` をデフォルトとして渡すのが想定 —
   * 一度 session 作成後は global 設定変更で過去 session の persona 表示は
   * 変わらない (Git commit Author header と同じ immutable semantic)。
   */
  function createNew(opts: {
    model: string
    connectionId: string
    title?: string
    kind?: AiSessionKind
    personaSkillId?: string
  }): AiSession {
    const existing = new Set(sessions.value.keys())
    const id = generateSessionId(new Date(), existing)
    const now = Date.now()
    const session: AiSession = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      kind: opts.kind ?? 'chat',
      title: opts.title ?? '',
      model: opts.model,
      connectionId: opts.connectionId,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
      lastMessagePreview: '',
      personaSkillId: opts.personaSkillId || undefined,
    }
    sessions.value.set(id, session)
    sessions.value = new Map(sessions.value)
    schedulePersist(id)
    return session
  }

  /** 既存セッションを直接登録（マイグレーション専用、外部からは呼ばない）。 */
  function upsertRaw(session: AiSession): void {
    sessions.value.set(session.id, session)
    sessions.value = new Map(sessions.value)
  }

  /** メッセージ配列を差し替え。`updatedAt` を更新して debounce 永続化。 */
  function updateMessages(id: string, messages: ChatMessage[]): void {
    const cur = sessions.value.get(id)
    if (!cur) return
    const updated: AiSession = {
      ...cur,
      messages,
      messageCount: messages.length,
      updatedAt: Date.now(),
    }
    sessions.value.set(id, updated)
    sessions.value = new Map(sessions.value)
    schedulePersist(id)
  }

  function setTitle(id: string, title: string): void {
    const cur = sessions.value.get(id)
    if (!cur || cur.title === title) return
    const updated: AiSession = {
      ...cur,
      title,
      updatedAt: Date.now(),
    }
    sessions.value.set(id, updated)
    sessions.value = new Map(sessions.value)
    schedulePersist(id)
  }

  function schedulePersist(id: string): void {
    const existing = persistTimers.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      persistTimers.delete(id)
      void persist(id)
    }, PERSIST_DEBOUNCE_MS)
    persistTimers.set(id, timer)
  }

  async function persist(id: string): Promise<void> {
    if (!isTauri) return
    const session = sessions.value.get(id)
    if (!session) return
    try {
      await writeAiSessionFile(aiSessionFilename(id), serialize(session))
    } catch (e) {
      console.warn(`[ai-sessions] persist ${id} failed:`, e)
    }
  }

  /** 即時にディスクに書き出す (debounce タイマーを flush)。 */
  async function flush(id: string): Promise<void> {
    const t = persistTimers.get(id)
    if (t) {
      clearTimeout(t)
      persistTimers.delete(id)
    }
    await persist(id)
  }

  async function deleteSession(id: string): Promise<void> {
    const t = persistTimers.get(id)
    if (t) {
      clearTimeout(t)
      persistTimers.delete(id)
    }
    sessions.value.delete(id)
    sessions.value = new Map(sessions.value)
    if (!isTauri) return
    try {
      await deleteAiSessionFile(aiSessionFilename(id))
    } catch (e) {
      console.warn(`[ai-sessions] delete ${id} failed:`, e)
    }
  }

  return {
    sessions,
    metaLoaded,
    loadAllMeta,
    get,
    listSorted,
    createNew,
    upsertRaw,
    updateMessages,
    setTitle,
    flush,
    deleteSession,
  }
})
