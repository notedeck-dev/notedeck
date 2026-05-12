import type { Command } from '@/commands/registry'
import { sendAiChatOnce } from '@/composables/useAiChat'

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
export const aiChatCapability: Command = {
  id: 'ai.chat',
  label: 'AI に問い合わせる',
  icon: 'ti-sparkles',
  category: 'general',
  shortcuts: [],
  aiTool: false,
  permissions: ['ai.invoke'],
  requiresConfirmation: false,
  signature: {
    description:
      'NoteDeck の AI に 1 ターンだけ問い合わせて応答テキストを得る。' +
      'AiScript プラグインや外部 API / CLI から呼ぶ用途。AI チャット本体' +
      'からの自己再帰呼出しは aiTool:false で塞がれている。',
    params: {
      prompt: {
        type: 'string',
        description: 'ユーザー側プロンプト (= user role の content)',
      },
      system: {
        type: 'string',
        description: 'システムプロンプト (= AI に与える役割設定)',
        optional: true,
      },
      model: {
        type: 'string',
        description: 'モデル override (省略時は現在の AI 設定を使う)',
        optional: true,
      },
      maxTokens: {
        type: 'number',
        description: '最大トークン数 (省略時はプロバイダのデフォルト)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ response: string }',
    },
    cheap: false,
  },
  visible: true,
  execute: async (params, ctx) => {
    const prompt = typeof params?.prompt === 'string' ? params.prompt : ''
    if (!prompt) throw new Error('prompt is required')

    if (!ctx?.aiConfig) {
      throw new Error(
        'ai.chat は dispatchCapability 経由で呼び出されている必要があります (AiConfig が必要)',
      )
    }
    const cfg = ctx.aiConfig
    const provider = cfg.provider
    const providerSettings =
      provider === 'anthropic'
        ? cfg.anthropic
        : provider === 'openai'
          ? cfg.openai
          : cfg.custom
    const model =
      typeof params?.model === 'string' && params.model.length > 0
        ? params.model
        : providerSettings.model

    const response = await sendAiChatOnce({
      provider,
      endpoint: providerSettings.endpoint,
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
}

export const AI_BUILTIN_CAPABILITIES: readonly Command[] = [aiChatCapability]
