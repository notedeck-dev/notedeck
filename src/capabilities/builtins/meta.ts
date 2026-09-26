import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * Meta 系 capability — AI が「自分が今どういう状態か」を知る入口。
 *
 * これがあると AI は「自分は readonly preset なので skills.append は呼べない、
 * ユーザーに preset 切替を提案しよう」と賢く立ち回れる。permission denied で
 * 初めて気付くフローを回避。
 *
 * 設計判断:
 * - すべて aiTool: true (AI 本体が自分のことを知るのは健全)
 * - permissions: [] (機密データなし、API キー / endpoint は明示的に除外)
 * - すべて cheap: true (ローカル参照のみ)
 */

export const metaPermissionsCapability = implementCore('meta.permissions')

export const metaActiveSkillsCapability = implementCore('meta.activeSkills')

export const metaPersonaCapability = implementCore('meta.persona')

export const metaConfigCapability = implementCore('meta.config')

/**
 * `meta.heartbeat` — HEARTBEAT daemon の現在設定スナップショットを返す
 * (read only)。AI 自身が「自分の起動条件 / 暴走防止上限」を理解できるが、
 * **編集は塞ぐ** (memory: feedback_ai_capability_scope の `heartbeat.write`
 * 塞ぐリスト — AI が interval / dailyMaxAiRuns を変えると自己強化 loop で
 * コスト爆発する)。
 */
export const metaHeartbeatCapability = implementCore('meta.heartbeat')

export const META_BUILTIN_CAPABILITIES: readonly Command[] = [
  metaPermissionsCapability,
  metaActiveSkillsCapability,
  metaPersonaCapability,
  metaConfigCapability,
  metaHeartbeatCapability,
]
