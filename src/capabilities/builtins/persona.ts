import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * Persona 系 capability。AI の「同一性設定」(memory:
 * project_self_extending_ide_roadmap)。
 *
 * AiConfig.personaSkillId は「このアプリの AI は誰か」というグローバル設定で、
 * isPersona: true な skill を 1 つ選ぶ。skill 編集 (skills.append / replaceSection)
 * とは別軸 — skill body の中身ではなく、どの skill を persona として
 * 立てるかの選択を AI 自身が会話で切り替えられるようにする。
 *
 * read は既存 `meta.persona` で済む (本モジュールは write 側のみ提供)。
 *
 * 設計判断:
 * - `ai.listPersonas` で利用可能な persona skill 一覧を返す
 *   (= skills.list でも見えるが、isPersona フィルタ済み版を提供)
 * - `ai.setPersona` で personaSkillId を切替 (空文字 = persona なし)
 * - 編集は `useAiConfig().save()` で ai.json5 に永続化、reloadAiConfig で
 *   chat 側に即時反映
 */

export const aiListPersonasCapability = implementCore('ai.listPersonas')

export const aiSetPersonaCapability = implementCore('ai.setPersona')

export const PERSONA_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiListPersonasCapability,
  aiSetPersonaCapability,
]
