import type {
  SessionMessage as WireMessage,
  AiSession as WireSession,
} from '@/bindings'
import type { ChatMessage } from '@/composables/useAiChat'

/**
 * AI セッションの型と wire 変換 (#782 Phase 2 / #1133 縦切り 3)。
 *
 * ファイル (`sessions/<id>.json5`) の書き手は notecore で、形式の正本も
 * Rust 側 (`crates/notecore/src/ai_sessions.rs`)。ここは notecore が返す wire
 * (bindings の `AiSession` / `SessionMessage`) とフロントの `ChatMessage` の
 * 相互変換だけを持つ。
 */

export const CURRENT_SCHEMA_VERSION = 1

export type AiSessionKind = 'chat' | 'command' | 'task' | 'heartbeat'

export interface AiSessionMeta {
  id: string
  kind: AiSessionKind
  title: string
  model: string
  connectionId: string
  createdAt: number
  updatedAt: number
  messageCount: number
  lastMessagePreview: string
  personaSkillId?: string
}

export interface AiSession extends AiSessionMeta {
  schemaVersion: number
  messages: ChatMessage[]
  triggeredSkillIds?: string[]
}

const KINDS = new Set<AiSessionKind>(['chat', 'command', 'task', 'heartbeat'])

export function messageFromWire(m: WireMessage): ChatMessage {
  const role =
    m.role === 'user' || m.role === 'assistant' || m.role === 'system'
      ? m.role
      : 'assistant'
  const out: ChatMessage = {
    id: m.id,
    role,
    content: m.content,
    timestamp: m.timestamp,
  }
  if (m.toolUseId) out.toolUseId = m.toolUseId
  if (m.toolUseName) out.toolUseName = m.toolUseName
  if (m.toolUseInput && typeof m.toolUseInput === 'object') {
    out.toolUseInput = m.toolUseInput as Record<string, unknown>
  }
  if (m.toolResultFor) out.toolResultFor = m.toolResultFor
  if (m.heartbeat) out.heartbeat = true
  return out
}

export function messageToWire(m: ChatMessage): WireMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: Math.round(m.timestamp),
    toolUseId: m.toolUseId ?? null,
    toolUseName: m.toolUseName ?? null,
    toolUseInput: (m.toolUseInput ?? null) as WireMessage['toolUseInput'],
    toolResultFor: m.toolResultFor ?? null,
    heartbeat: m.heartbeat ? true : null,
  }
}

export function sessionFromWire(w: WireSession): AiSession {
  const kind = KINDS.has(w.kind as AiSessionKind)
    ? (w.kind as AiSessionKind)
    : 'chat'
  const session: AiSession = {
    schemaVersion: w.schemaVersion,
    id: w.id,
    kind,
    title: w.title,
    model: w.model,
    connectionId: w.connectionId,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    messageCount: w.messageCount,
    lastMessagePreview: w.lastMessagePreview,
    messages: w.messages.map(messageFromWire),
  }
  if (w.personaSkillId) session.personaSkillId = w.personaSkillId
  const triggered = w.triggeredSkillIds ?? []
  if (triggered.length > 0) session.triggeredSkillIds = [...triggered]
  return session
}

/**
 * ドロワー用の preview (notecore と同じ規則)。ローカルの写しを更新した直後に
 * サーバー往復を待たず表示するために持つ。
 */
export function buildLastMessagePreview(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.toolResultFor || m.toolUseId) continue
    const flat = (m.content ?? '').trim().replace(/\s+/g, ' ').trim()
    if (flat.length === 0) continue
    const chars = [...flat]
    return chars.length > 120 ? `${chars.slice(0, 120).join('')}…` : flat
  }
  return ''
}
