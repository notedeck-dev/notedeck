import type { Command } from '@/commands/registry'
import { useAiConfig } from '@/composables/useAiConfig'
import { useSkillsStore } from '@/stores/skills'

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

export const aiListPersonasCapability: Command = {
  id: 'ai.listPersonas',
  label: 'persona 用 skill 一覧',
  icon: 'ti-user-circle',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.read'],
  signature: {
    description:
      'persona として選べる skill 一覧 (= isPersona:true な skill のみ)。' +
      ' 現在 active な persona は `active: true`。',
    params: {},
    returns: {
      type: 'array',
      description:
        '各要素は { id, name, description, mode, scope, active: boolean }',
    },
    cheap: true,
  },
  visible: false,
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
        scope: s.scope,
        active: s.id === currentId,
      }))
  },
}

export const aiSetPersonaCapability: Command = {
  id: 'ai.setPersona',
  label: 'AI persona を切替',
  icon: 'ti-user-circle',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['ai.persona.write'],
  requiresConfirmation: (params) => {
    const id = typeof params?.skillId === 'string' ? params.skillId : ''
    const skillsStore = useSkillsStore()
    const target = id ? skillsStore.skills.find((s) => s.id === id) : null
    return {
      title: 'AI persona を切替',
      message: id
        ? target
          ? `AI persona を「${target.name}」に切り替えます。chat / heartbeat / command / task すべての session に反映されます。`
          : `不明な skill id "${id}" を persona にしようとしています。`
        : 'AI persona を解除します (= 通常の汎用 AI として動作)。',
      okLabel: '切替',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'AI の persona (= 同一性設定) を切り替える。skillId は isPersona:true な ' +
      'skill の id (ai.listPersonas で取得)、空文字を渡せば persona 解除。' +
      ' chat / heartbeat / command / task すべての AI session に反映される。',
    params: {
      skillId: {
        type: 'string',
        description: '新しい persona skill id (空文字で解除 = 通常の汎用 AI)',
      },
    },
    returns: {
      type: 'object',
      description: '{ personaSkillId: string, persona: { id, name } | null }',
    },
  },
  visible: false,
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
}

export const PERSONA_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiListPersonasCapability,
  aiSetPersonaCapability,
]
