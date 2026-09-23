import type { Command } from '@/commands/registry'
import { useAiSessionsStore } from '@/stores/aiSessions'
import { implement } from '../declare'

/**
 * AI Sessions 系 capability — 過去の AI 会話履歴へのアクセス。
 *
 * self-profile / learning-journal のような自己編集 skill が
 * 「自分が以前何を言ったか」「ユーザーと何を話したか」を振り返って
 * 自分の body を更新するときに使う。
 *
 * 機密性: AI session は本人の会話なので機密データではないが、
 * permission `ai.sessions.read` で明示的に管理する (= ai.json5 で off に
 * できる)。
 */

export const aiSessionsListCapability = implement('ai.sessions.list', {
  execute: async () => {
    const store = useAiSessionsStore()
    await store.loadAllMeta()
    return store.listSorted().map((m) => ({
      id: m.id,
      kind: m.kind,
      title: m.title,
      updatedAt: m.updatedAt,
      messageCount: m.messageCount,
    }))
  },
})

export const aiSessionsReadCapability = implement('ai.sessions.read', {
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('ai.sessions.read: id is required')
    const store = useAiSessionsStore()
    await store.loadAllMeta()
    const session = store.get(id)
    if (!session) {
      throw new Error(`ai.sessions.read: session "${id}" not found`)
    }
    return {
      id: session.id,
      kind: session.kind,
      title: session.title,
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }
  },
})

export const aiSessionsSearchCapability = implement('ai.sessions.search', {
  execute: async (params) => {
    const query = typeof params?.query === 'string' ? params.query : ''
    if (!query) throw new Error('ai.sessions.search: query is required')
    const limit =
      typeof params?.limit === 'number' && params.limit > 0 ? params.limit : 20
    const store = useAiSessionsStore()
    await store.loadAllMeta()
    const needle = query.toLowerCase()
    const results: { id: string; title: string; snippet: string }[] = []
    for (const meta of store.listSorted()) {
      if (results.length >= limit) break
      const session = store.get(meta.id)
      if (!session) continue
      for (const m of session.messages) {
        const hay = (m.content ?? '').toLowerCase()
        const idx = hay.indexOf(needle)
        if (idx >= 0) {
          const start = Math.max(0, idx - 40)
          const end = Math.min(m.content.length, idx + query.length + 40)
          const snippet =
            (start > 0 ? '…' : '') +
            m.content.slice(start, end) +
            (end < m.content.length ? '…' : '')
          results.push({ id: meta.id, title: meta.title, snippet })
          break
        }
      }
    }
    return results
  },
})

export const AI_SESSIONS_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiSessionsListCapability,
  aiSessionsReadCapability,
  aiSessionsSearchCapability,
]
