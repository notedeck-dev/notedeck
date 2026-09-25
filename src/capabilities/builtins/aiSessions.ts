import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

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

export const aiSessionsListCapability = implementCore('ai.sessions.list')

export const aiSessionsReadCapability = implementCore('ai.sessions.read')

export const aiSessionsSearchCapability = implementCore('ai.sessions.search')

export const AI_SESSIONS_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiSessionsListCapability,
  aiSessionsReadCapability,
  aiSessionsSearchCapability,
]
