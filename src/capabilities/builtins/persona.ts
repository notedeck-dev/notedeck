import type { Command } from '@/commands/registry'
import { useAiConfig } from '@/composables/useAiConfig'
import { i18n } from '@/i18n'
import { useSkillsStore } from '@/stores/skills'
import { implement } from '../declare'

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

export const aiListPersonasCapability = implement('ai.listPersonas', {
  execute: () => {
    const skillsStore = useSkillsStore()
    const { config } = useAiConfig()
    const currentId = config.value.personaSkillId ?? ''
    return skillsStore.skills
      .filter((s) => s.isPersona === true)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        mode: s.mode,
        active: s.id === currentId,
      }))
  },
})

export const aiSetPersonaCapability = implement('ai.setPersona', {
  requiresConfirmation: (params) => {
    const id = typeof params?.skillId === 'string' ? params.skillId : ''
    const skillsStore = useSkillsStore()
    const target = id ? skillsStore.skills.find((s) => s.id === id) : null
    return {
      title: i18n.ts._personaCapability.title,
      message: id
        ? target
          ? i18n.tsx._personaCapability.switchMessage({ name: target.name })
          : i18n.tsx._personaCapability.unknownMessage({ id })
        : i18n.ts._personaCapability.clearMessage,
      okLabel: i18n.ts._common.switch,
      cancelLabel: i18n.ts._common.cancel,
      type: 'warning',
    }
  },
  execute: (params) => {
    const skillId = typeof params?.skillId === 'string' ? params.skillId : ''
    const skillsStore = useSkillsStore()
    const { config, save } = useAiConfig()
    if (skillId) {
      const skill = skillsStore.skills.find((s) => s.id === skillId)
      if (!skill) {
        throw new Error(`ai.setPersona: skill "${skillId}" not found`)
      }
      if (skill.isPersona !== true) {
        throw new Error(
          `ai.setPersona: skill "${skillId}" (${skill.name}) is not flagged as persona`,
        )
      }
      config.value.personaSkillId = skillId
      save()
      return {
        personaSkillId: skillId,
        persona: { id: skill.id, name: skill.name },
      }
    }
    config.value.personaSkillId = ''
    save()
    return { personaSkillId: '', persona: null }
  },
})

export const PERSONA_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiListPersonasCapability,
  aiSetPersonaCapability,
]
