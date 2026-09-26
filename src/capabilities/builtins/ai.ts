import type { Command } from '@/commands/registry'
import { sendAiChatOnce } from '@/composables/useAiChat'
import { resolveAiConnection } from '@/composables/useAiConfig'
import { useVault } from '@/composables/useVault'
import { implement } from '../declare'

/**
 * `ai.chat` — NoteDeck 本体の AI に 1 ターンだけ問い合わせて応答を得る。
 *
 * `aiTool: false` がガード: AI チャット本体 (= AI 自身) からは tool として
 * 見えないが、それ以外の経路 (AiScript / コマンドパレット / HTTP API / CLI)
 * は通常通り使える。
 *
 * - AI が AI を呼ぶ価値は Phase 1 では薄い (同じモデル) ため AI 本体だけ閉鎖
 * - 料金不透明リスクを AI 自発呼出しに対してだけ防ぐ
 * - 他経路は **ユーザー意図的トリガー** なので開放
 *
 * 設計詳細: plans/atomic-crunching-floyd.md
 */
export const aiChatCapability = implement('ai.chat', {
  requiresConfirmation: false,
  execute: async (params, ctx) => {
    const prompt = typeof params?.prompt === 'string' ? params.prompt : ''
    if (!prompt) throw new Error('prompt is required')

    if (!ctx?.aiConfig) {
      throw new Error(
        'ai.chat must be called through dispatchCapability (AiConfig is required)',
      )
    }
    const cfg = ctx.aiConfig
    const vault = useVault()
    await vault.refresh()
    const resolved = resolveAiConnection(cfg, vault.connections.value)
    if (!resolved) {
      throw new Error(
        'No AI connection is selected. Choose a Vault connection in the agent settings',
      )
    }
    const model =
      typeof params?.model === 'string' && params.model.length > 0
        ? params.model
        : resolved.model

    const response = await sendAiChatOnce({
      connectionId: resolved.connection.id,
      model,
      history: [
        {
          id: `ai-chat-cap-${Date.now()}`,
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ],
      system: typeof params?.system === 'string' ? params.system : undefined,
      maxTokens:
        typeof params?.maxTokens === 'number' ? params.maxTokens : undefined,
    })

    return { response }
  },
})

export const AI_BUILTIN_CAPABILITIES: readonly Command[] = [aiChatCapability]
