/**
 * AI の tool 呼び出しカードに出す人間語の 1 行 (#1162)。
 *
 * 記憶 (`memory.update`) と人格 (`soul.propose`) は引数の JSON を読ませず、
 * 「あなたについて: + たかと呼ぶ」のように差分 1 行で見せる。それ以外は null
 * (= 従来どおり capability 名と引数 JSON)。
 */
import { i18n } from '@/i18n'

export function describeToolUse(
  name: string | undefined,
  input: Record<string, unknown> | undefined,
): string | null {
  if (!name) return null
  const str = (k: string): string => {
    const v = input?.[k]
    return typeof v === 'string' ? v.trim() : ''
  }
  if (name === 'memory.update' || name === 'memory_update') {
    const target =
      str('target') === 'user'
        ? i18n.ts._deckAiColumn._toolSummary.targetUser
        : i18n.ts._deckAiColumn._toolSummary.targetMemory
    const content = str('content')
    const old = str('old_text')
    switch (str('action')) {
      case 'add':
        return `${target}: + ${content}`
      case 'replace':
        return `${target}: ${old} → ${content}`
      case 'remove':
        return `${target}: − ${old}`
      default:
        return null
    }
  }
  if (name === 'soul.propose' || name === 'soul_propose') {
    const reason = str('reason')
    return reason
      ? i18n.tsx._deckAiColumn._toolSummary.soulProposeWithReason({ reason })
      : i18n.ts._deckAiColumn._toolSummary.soulPropose
  }
  return null
}
