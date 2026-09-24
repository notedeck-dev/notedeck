import type { Command } from '@/commands/registry'
import { resolveAiConnection } from '@/composables/useAiConfig'
import { useVault } from '@/composables/useVault'
import { PERMISSION_KEYS } from '@/permissions/schema'
import { profileFor, resolveFor } from '@/permissions/store'
import { useSkillsStore } from '@/stores/skills'
import { implement } from '../declare'

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

export const metaPermissionsCapability = implement('meta.permissions', {
  execute: (_params, ctx) => {
    // 呼んだ principal 自身の有効権限を返す (#712 §5.4)。chat プロファイルを
    // 一律で返すと external / heartbeat から呼ばれた側が自分の権限を誤認する。
    const principal = ctx?.principal
    if (!principal) {
      throw new Error(
        'meta.permissions: principal が ctx に渡される dispatchCapability 経由で呼ばれる必要があります',
      )
    }
    const profile = profileFor(principal)
    if (!profile) {
      // user: プロファイル無し = 常時許可を明示した形で返す
      return {
        principal: principal.kind,
        preset: null,
        resolved: Object.fromEntries(
          PERMISSION_KEYS.map((k: string) => [k, true]),
        ),
      }
    }
    return {
      principal: principal.kind,
      preset: profile.preset,
      resolved: resolveFor(principal),
    }
  },
})

export const metaActiveSkillsCapability = implement('meta.activeSkills', {
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
})

export const metaPersonaCapability = implement('meta.persona', {
  execute: (_params, ctx) => {
    const personaId = ctx?.aiConfig?.personaSkillId
    if (!personaId) return null
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === personaId)
    if (!skill) return null
    return { id: skill.id, name: skill.name }
  },
})

export const metaConfigCapability = implement('meta.config', {
  execute: (_params, ctx) => {
    if (!ctx?.aiConfig) {
      throw new Error(
        'meta.config: aiConfig が ctx に渡される dispatchCapability 経由で呼ばれる必要があります',
      )
    }
    const cfg = ctx.aiConfig
    // cheap capability なので Tauri 呼出 (vault.refresh) はしない。
    // 接続一覧の cache は AI カラム側の watch で常に最新化されている。
    const vault = useVault()
    const resolved = resolveAiConnection(cfg, vault.connections.value)
    // dataSources は preset ベースで bool だけ返す (機密マップ素出しを避ける)
    const ds = cfg.dataSources.custom
    return {
      protocol: resolved?.protocol ?? '',
      model: resolved?.model ?? '',
      dataSourcesEnabled: {
        currentAccount: ds.currentAccount,
        currentColumn: ds.currentColumn,
        visibleNotes: ds.visibleNotes,
        recentConversation: ds.recentConversation,
        memos: ds.memos,
      },
    }
  },
})

/**
 * `meta.heartbeat` — HEARTBEAT daemon の現在設定スナップショットを返す
 * (read only)。AI 自身が「自分の起動条件 / 暴走防止上限」を理解できるが、
 * **編集は塞ぐ** (memory: feedback_ai_capability_scope の `heartbeat.write`
 * 塞ぐリスト — AI が interval / dailyMaxAiRuns を変えると自己強化 loop で
 * コスト爆発する)。
 */
export const metaHeartbeatCapability = implement('meta.heartbeat', {
  execute: (_params, ctx) => {
    if (!ctx?.aiConfig) {
      throw new Error(
        'meta.heartbeat: aiConfig が ctx に渡される dispatchCapability 経由で呼ばれる必要があります',
      )
    }
    const hb = ctx.aiConfig.heartbeat
    return {
      enabled: hb.enabled,
      intervalMinutes: hb.intervalMinutes,
      target: hb.target,
      dailyMaxAiRuns: hb.dailyMaxAiRuns,
      onDailyLimit: hb.onDailyLimit,
      desktopNotification: hb.desktopNotification,
      cheapCheck: {
        enabled: hb.cheapCheck.enabled,
        maxSkipHours: hb.cheapCheck.maxSkipHours,
      },
      // permissions の生 map は素出ししない (= meta.config と同様の方針)。
      // 権限は permissions.json5 の ai.heartbeat プロファイル (#712)
      permissionsPreset: profileFor({ kind: 'ai.heartbeat' })?.preset ?? null,
    }
  },
})

export const META_BUILTIN_CAPABILITIES: readonly Command[] = [
  metaPermissionsCapability,
  metaActiveSkillsCapability,
  metaPersonaCapability,
  metaConfigCapability,
  metaHeartbeatCapability,
]
