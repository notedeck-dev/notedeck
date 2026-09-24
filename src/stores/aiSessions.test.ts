import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiSessionCreate,
  SessionMessage,
  AiSession as WireSession,
} from '@/bindings'

// notecore (単一の書き手) をメモリで模す。構造化された操作だけを受ける。
const backend = new Map<string, WireSession>()
const calls: string[] = []

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}
function upd(id: string, patch: (s: WireSession) => void) {
  const s = backend.get(id)
  if (!s) throw new Error(`no session ${id}`)
  patch(s)
  s.updatedAt += 1
  s.messageCount = s.messages.length
  return ok(structuredClone(s))
}

vi.mock('@/utils/settingsFs', () => ({ isTauri: true }))
vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      aiSessionsLoadAll: async () => {
        calls.push('loadAll')
        return ok([...backend.values()].map((s) => structuredClone(s)))
      },
      aiSessionGet: async (id: string) => {
        calls.push(`get:${id}`)
        const s = backend.get(id)
        return s
          ? ok(structuredClone(s))
          : { status: 'error', error: { code: 'x', message: 'missing' } }
      },
      aiSessionCreate: async (req: AiSessionCreate) => {
        calls.push(`create:${req.id}`)
        const s: WireSession = {
          schemaVersion: 1,
          id: req.id,
          kind: req.kind,
          title: req.title,
          model: req.model,
          connectionId: req.connectionId,
          createdAt: 100,
          updatedAt: 100,
          messages: [],
          personaSkillId: req.personaSkillId ?? null,
          triggeredSkillIds: [],
          messageCount: 0,
          lastMessagePreview: '',
        }
        backend.set(req.id, s)
        return ok(structuredClone(s))
      },
      aiSessionAppend: async (id: string, messages: SessionMessage[]) => {
        calls.push(`append:${id}:${messages.map((m) => m.id).join(',')}`)
        return upd(id, (s) => {
          for (const m of messages) {
            const i = s.messages.findIndex((x) => x.id === m.id)
            if (i >= 0) s.messages[i] = m
            else s.messages.push(m)
          }
        })
      },
      aiSessionRemoveMessages: async (id: string, ids: string[]) => {
        calls.push(`remove:${id}:${ids.join(',')}`)
        return upd(id, (s) => {
          s.messages = s.messages.filter((m) => !ids.includes(m.id))
        })
      },
      aiSessionRename: async (id: string, title: string) => {
        calls.push(`rename:${id}:${title}`)
        return upd(id, (s) => {
          s.title = title
        })
      },
      aiSessionAddTriggeredSkills: async (id: string, skillIds: string[]) => {
        calls.push(`skills:${id}:${skillIds.join(',')}`)
        return upd(id, (s) => {
          for (const sid of skillIds) {
            if (!s.triggeredSkillIds?.includes(sid))
              s.triggeredSkillIds?.push(sid)
          }
        })
      },
      aiSessionDelete: async (id: string) => {
        calls.push(`delete:${id}`)
        backend.delete(id)
        return ok(null)
      },
    },
  }
})

import { useAiSessionsStore } from '@/stores/aiSessions'

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  backend.clear()
  calls.length = 0
  setActivePinia(createPinia())
})

describe('useAiSessionsStore (#1133: notecore が単一の書き手)', () => {
  it('createNew は同期的に写しを返し、notecore に作成を送る', async () => {
    const store = useAiSessionsStore()
    const s = store.createNew({
      model: 'm',
      connectionId: 'c',
      personaSkillId: 'p',
    })
    expect(store.get(s.id)?.personaSkillId).toBe('p')
    await flush()
    expect(calls).toEqual([`create:${s.id}`])
    expect(backend.get(s.id)?.personaSkillId).toBe('p')
    // 応答で写しが揃う (notecore の updatedAt)
    expect(store.get(s.id)?.updatedAt).toBe(100)
  })

  it('appendMessages は楽観的に写しへ足し、同じ id は差し替え、notecore に append を送る', async () => {
    const store = useAiSessionsStore()
    const s = store.createNew({ model: 'm', connectionId: 'c' })
    store.appendMessages(s.id, [
      { id: 'u1', role: 'user', content: 'q', timestamp: 1 },
    ])
    expect(store.get(s.id)?.messages.map((m) => m.id)).toEqual(['u1'])
    store.appendMessages(s.id, [
      { id: 'u1', role: 'user', content: 'q2', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'a', timestamp: 2 },
    ])
    expect(store.get(s.id)?.messages.map((m) => m.content)).toEqual(['q2', 'a'])
    await flush()
    expect(calls.slice(1)).toEqual([
      `append:${s.id}:u1`,
      `append:${s.id}:u1,a1`,
    ])
    expect(backend.get(s.id)?.messages).toHaveLength(2)
    expect(store.listSorted()[0]?.lastMessagePreview).toBe('a')
  })

  it('setLocalMessages は notecore に書かず、reload で揃う', async () => {
    const store = useAiSessionsStore()
    const s = store.createNew({ model: 'm', connectionId: 'c' })
    await flush()
    store.setLocalMessages(s.id, [
      { id: 'ph', role: 'assistant', content: '途中', timestamp: 1 },
    ])
    expect(store.get(s.id)?.messages).toHaveLength(1)
    await flush()
    expect(calls.filter((c) => c.startsWith('append'))).toEqual([])
    await store.reload(s.id)
    expect(store.get(s.id)?.messages).toEqual([])
  })

  it('removeMessages / setTitle / addTriggeredSkillIds / deleteSession は構造化操作を送る', async () => {
    const store = useAiSessionsStore()
    const s = store.createNew({ model: 'm', connectionId: 'c' })
    store.appendMessages(s.id, [
      { id: 'u1', role: 'user', content: 'q', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'a', timestamp: 2 },
    ])
    store.removeMessages(s.id, ['a1'])
    expect(store.get(s.id)?.messages.map((m) => m.id)).toEqual(['u1'])
    store.setTitle(s.id, '題名')
    store.setTitle(s.id, '題名') // 同じなら送らない
    store.addTriggeredSkillIds(s.id, ['mfm-art'])
    store.addTriggeredSkillIds(s.id, ['translator', 'mfm-art'])
    store.addTriggeredSkillIds(s.id, ['mfm-art']) // 新規なしは送らない
    expect(store.get(s.id)?.triggeredSkillIds).toEqual([
      'mfm-art',
      'translator',
    ])
    await flush()
    expect(calls.slice(2)).toEqual([
      `remove:${s.id}:a1`,
      `rename:${s.id}:題名`,
      `skills:${s.id}:mfm-art`,
      `skills:${s.id}:translator,mfm-art`,
    ])
    await store.deleteSession(s.id)
    expect(store.get(s.id)).toBeUndefined()
    expect(backend.has(s.id)).toBe(false)
  })

  it('loadAllMeta は notecore から全件を読み、未知の session id への操作は無視する', async () => {
    backend.set('legacy', {
      schemaVersion: 1,
      id: 'legacy',
      kind: 'heartbeat',
      title: 't',
      model: 'm',
      connectionId: 'c',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      personaSkillId: null,
      triggeredSkillIds: ['a'],
      messageCount: 0,
      lastMessagePreview: '',
    })
    const store = useAiSessionsStore()
    await store.loadAllMeta()
    expect(store.get('legacy')?.kind).toBe('heartbeat')
    expect(store.get('legacy')?.triggeredSkillIds).toEqual(['a'])
    expect(() => store.addTriggeredSkillIds('nope', ['a'])).not.toThrow()
    store.appendMessages('nope', [
      { id: 'x', role: 'user', content: 'x', timestamp: 0 },
    ])
    await flush()
    expect(calls).toEqual(['loadAll'])
  })
})
