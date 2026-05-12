import type { Command } from '@/commands/registry'
import { resolvePermissions } from '@/composables/useAiConfig'
import { useSkillsStore } from '@/stores/skills'

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

export const metaPermissionsCapability: Command = {
  id: 'meta.permissions',
  label: '現在の AI permission を取得',
  icon: 'ti-shield-check',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在の AI 設定の permission preset と、解決済の permission map を返す。' +
      ' AI が自分が何を許されているか把握するため。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ preset: "readonly"|"safe"|"full"|"custom", resolved: { [key]: boolean } }',
    },
    cheap: true,
  },
  visible: false,
  execute: (_params, ctx) => {
    if (!ctx?.aiConfig) {
      throw new Error(
        'meta.permissions: aiConfig が ctx に渡される dispatchCapability 経由で呼ばれる必要があります',
      )
    }
    const cfg = ctx.aiConfig
    return {
      preset: cfg.permissions.preset,
      resolved: resolvePermissions(cfg.permissions),
    }
  },
}

export const metaActiveSkillsCapability: Command = {
  id: 'meta.activeSkills',
  label: 'active な skill 一覧',
  icon: 'ti-book-2',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在 active な (= system prompt に乗っている) skill のメタ一覧。',
    params: {},
    returns: {
      type: 'array',
      description: '[{ id, name, mode, isPersona }] の配列',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useSkillsStore()
    const activeIds = new Set(store.effectiveActiveIds)
    return store.skills
      .filter((s) => activeIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        mode: s.mode,
        isPersona: s.isPersona ?? false,
      }))
  },
}

export const metaPersonaCapability: Command = {
  id: 'meta.persona',
  label: '現在の AI persona',
  icon: 'ti-user-circle',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在のセッションで AI が振る舞っている persona (= isPersona:true な skill) ' +
      'を返す。設定されていなければ null。',
    params: {},
    returns: {
      type: 'object',
      description: '{ id, name } | null',
    },
    cheap: true,
  },
  visible: false,
  execute: (_params, ctx) => {
    const personaId = ctx?.aiConfig?.personaSkillId
    if (!personaId) return null
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === personaId)
    if (!skill) return null
    return { id: skill.id, name: skill.name }
  },
}

export const metaConfigCapability: Command = {
  id: 'meta.config',
  label: '現在の AI 設定スナップショット',
  icon: 'ti-settings',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在の AI 設定の機密でない部分 (provider / model / dataSources flags) を返す。' +
      ' API キー / endpoint / custom permissions の生 map は **明示的に除外**。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ provider, model, dataSourcesEnabled: { [key]: boolean } }',
    },
    cheap: true,
  },
  visible: false,
  execute: (_params, ctx) => {
    if (!ctx?.aiConfig) {
      throw new Error(
        'meta.config: aiConfig が ctx に渡される dispatchCapability 経由で呼ばれる必要があります',
      )
    }
    const cfg = ctx.aiConfig
    const providerSettings =
      cfg.provider === 'anthropic'
        ? cfg.anthropic
        : cfg.provider === 'openai'
          ? cfg.openai
          : cfg.custom
    // dataSources は preset ベースで bool だけ返す (機密マップ素出しを避ける)
    const ds = cfg.dataSources.custom
    return {
      provider: cfg.provider,
      model: providerSettings.model,
      dataSourcesEnabled: {
        currentAccount: ds.currentAccount,
        currentColumn: ds.currentColumn,
        visibleNotes: ds.visibleNotes,
        recentConversation: ds.recentConversation,
        memos: ds.memos,
      },
    }
  },
}

export const META_BUILTIN_CAPABILITIES: readonly Command[] = [
  metaPermissionsCapability,
  metaActiveSkillsCapability,
  metaPersonaCapability,
  metaConfigCapability,
]
