/**
 * useAiSessionsStore — AI セッション (`sessions/<id>.json5`) のデバイス側の写し。
 *
 * ファイルの書き手は notecore (#1133 縦切り 3)。このストアは
 *
 * - notecore から読んだセッションを常駐させ (数百件なら数 MB)、UI に reactive に
 *   見せる
 * - 「作成 / メッセージ追加 / メッセージ削除 / 改名 / trigger skill の累積 /
 *   削除」の構造化された操作を notecore に送り、応答で写しを揃える。操作は
 *   楽観的にローカルへ先に反映する (呼び出し側は同期的に `get()` できる)
 * - 進行中のターンの表示 (placeholder / ストリーミング本文) はローカルだけの
 *   状態 (`setLocalMessages`)。確定したメッセージは notecore が書き、ターンの
 *   終わりに `reload()` で写しを揃える
 *
 * id (= ファイル名 stem) はデバイスが採番する (ローカル時刻の Zettelkasten 形式)。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage } from '@/composables/useAiChat'
import type {
  AiSession,
  AiSessionKind,
  AiSessionMeta,
} from '@/services/aiSessionCodec'
import {
  buildLastMessagePreview,
  CURRENT_SCHEMA_VERSION,
  messageToWire,
  sessionFromWire,
} from '@/services/aiSessionCodec'
import { generateSessionId } from '@/utils/aiSessionId'
import { isTauri } from '@/utils/settingsFs'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type {
  AiSession,
  AiSessionKind,
  AiSessionMeta,
} from '@/services/aiSessionCodec'

export const useAiSessionsStore = defineStore('aiSessions', () => {
  /** セッション本体 (メタ + 本文) の写し。id をキーとする。 */
  const sessions = ref<Map<string, AiSession>>(new Map())
  /** 全件 load 済みフラグ。`loadAllMeta()` で立てる。 */
  const metaLoaded = ref(false)

  function commit(session: AiSession): void {
    sessions.value.set(session.id, session)
    // ref<Map> は in-place mutation 後に再代入で reactivity を発火
    sessions.value = new Map(sessions.value)
  }

  /** notecore の応答で写しを揃える (ローカルの楽観的更新を上書きする) */
  function absorb(wire: Parameters<typeof sessionFromWire>[0]): AiSession {
    const session = sessionFromWire(wire)
    commit(session)
    return session
  }

  /**
   * 全セッションを notecore から一括ロード。失敗は warn (メモリ上の写しは
   * そのまま)。Tauri の外 (ブラウザ開発) ではメモリだけで動く。
   */
  async function loadAllMeta(): Promise<void> {
    if (metaLoaded.value) return
    if (!isTauri) {
      metaLoaded.value = true
      return
    }
    try {
      const all = unwrap(await commands.aiSessionsLoadAll())
      for (const w of all) {
        sessions.value.set(w.id, sessionFromWire(w))
      }
    } catch (e) {
      console.warn('[ai-sessions] load failed:', e)
    }
    sessions.value = new Map(sessions.value)
    metaLoaded.value = true
  }

  function get(id: string): AiSession | undefined {
    return sessions.value.get(id)
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

  /** notecore への操作。失敗は warn に残し、写しは楽観的更新のまま。 */
  function send(
    label: string,
    op: () => Promise<
      | { status: 'ok'; data: Parameters<typeof sessionFromWire>[0] }
      | { status: 'error'; error: unknown }
    >,
  ): void {
    if (!isTauri) return
    void op()
      .then((res) => {
        absorb(unwrap(res))
      })
      .catch((e) => {
        console.warn(`[ai-sessions] ${label} failed:`, e)
      })
  }

  /**
   * 新規セッションを作る。id はここで採番し、notecore に作成を送る。
   * `personaSkillId` は session に snapshot 保存される (#491): 一度作成した後は
   * global 設定を変えても過去 session の persona は固定 (Git commit の Author
   * header と同じ immutable semantic)。
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
    commit(session)
    send('create', () =>
      commands.aiSessionCreate({
        id,
        kind: session.kind,
        title: session.title,
        model: session.model,
        connectionId: session.connectionId,
        personaSkillId: session.personaSkillId ?? null,
      }),
    )
    return session
  }

  /**
   * 確定したメッセージを末尾に足す (notecore に書かせる)。同じ id が既に
   * あれば差し替える。ターンの進行中の表示は `setLocalMessages`。
   */
  function appendMessages(id: string, messages: ChatMessage[]): void {
    if (messages.length === 0) return
    const cur = sessions.value.get(id)
    if (!cur) return
    const next = [...cur.messages]
    for (const m of messages) {
      const i = next.findIndex((x) => x.id === m.id)
      if (i >= 0) next[i] = m
      else next.push(m)
    }
    commit({
      ...cur,
      messages: next,
      messageCount: next.length,
      updatedAt: Date.now(),
    })
    send('append', () =>
      commands.aiSessionAppend(id, messages.map(messageToWire)),
    )
  }

  /** 1 件を差し替える (受信箱カードの状態更新など)。同じ id は notecore 側でも置換 */
  function replaceMessage(id: string, message: ChatMessage): void {
    appendMessages(id, [message])
  }

  /** メッセージを id で取り除く (失敗ターンの再試行 #508 / #737)。 */
  function removeMessages(id: string, messageIds: readonly string[]): void {
    if (messageIds.length === 0) return
    const cur = sessions.value.get(id)
    if (!cur) return
    commit({
      ...cur,
      messages: cur.messages.filter((m) => !messageIds.includes(m.id)),
      updatedAt: Date.now(),
    })
    send('remove', () => commands.aiSessionRemoveMessages(id, [...messageIds]))
  }

  /**
   * 写しだけを差し替える (notecore には書かない)。進行中のターンの placeholder /
   * ストリーミング本文の表示用。確定分は notecore が書き、ターンの終わりに
   * `reload()` で揃える。
   */
  function setLocalMessages(id: string, messages: ChatMessage[]): void {
    const cur = sessions.value.get(id)
    if (!cur) return
    commit({ ...cur, messages, messageCount: messages.length })
  }

  /** notecore から読み直して写しを揃える。 */
  async function reload(id: string): Promise<void> {
    if (!isTauri) return
    try {
      absorb(unwrap(await commands.aiSessionGet(id)))
    } catch (e) {
      console.warn(`[ai-sessions] reload ${id} failed:`, e)
    }
  }

  function setTitle(id: string, title: string): void {
    const cur = sessions.value.get(id)
    if (!cur || cur.title === title) return
    commit({ ...cur, title, updatedAt: Date.now() })
    send('rename', () => commands.aiSessionRename(id, title))
  }

  /**
   * このターンで発火した trigger skill の id をセッションへ累積する (#725)。
   * 既存との union (初出順維持) で、新規 id がなければ no-op。
   */
  function addTriggeredSkillIds(id: string, skillIds: readonly string[]): void {
    if (skillIds.length === 0) return
    const cur = sessions.value.get(id)
    if (!cur) return
    const merged = [...(cur.triggeredSkillIds ?? [])]
    const set = new Set(merged)
    for (const sid of skillIds) {
      if (!set.has(sid)) {
        set.add(sid)
        merged.push(sid)
      }
    }
    if (merged.length === (cur.triggeredSkillIds?.length ?? 0)) return
    commit({ ...cur, triggeredSkillIds: merged, updatedAt: Date.now() })
    send('add-triggered-skills', () =>
      commands.aiSessionAddTriggeredSkills(id, [...skillIds]),
    )
  }

  async function deleteSession(id: string): Promise<void> {
    sessions.value.delete(id)
    sessions.value = new Map(sessions.value)
    if (!isTauri) return
    try {
      unwrap(await commands.aiSessionDelete(id))
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
    appendMessages,
    replaceMessage,
    removeMessages,
    setLocalMessages,
    reload,
    setTitle,
    addTriggeredSkillIds,
    deleteSession,
  }
})
