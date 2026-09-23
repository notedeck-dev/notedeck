import { validateAiScript } from '@/aiscript/validate'
import type { Command, PreflightFailure } from '@/commands/registry'
import {
  type AiScriptLogLevel,
  type AiScriptSourceKind,
  useAiScriptLogsStore,
} from '@/stores/aiscriptLogs'
import { implement } from '../declare'

/**
 * AiScript 系 capability — AI が生成した AiScript ソースを構文検証する
 * (= LSP フィードバックループの中核, #553)。
 *
 * AI が `plugins.create` / `widgets.create` を呼ぶ前に必ずここを通す運用に
 * することで、syntax error の入った src がユーザー確認ダイアログに到達する
 * 前に AI 側で修正できる。dispatcher 側の preflight でも同じ検証が走るので
 * 二重防壁になる。
 *
 * readonly capability (permissions: []) で副作用なし。
 */

export const aiscriptValidateCapability = implement('aiscript.validate', {
  execute: (params) => {
    const src = typeof params?.src === 'string' ? params.src : null
    if (src === null) throw new Error('aiscript.validate: src is required')
    const entryPoint =
      params?.entryPoint === 'plugin' || params?.entryPoint === 'widget'
        ? params.entryPoint
        : undefined
    return validateAiScript(src, { entryPoint })
  },
})

const LOG_SOURCE_KINDS: readonly AiScriptSourceKind[] = [
  'plugin',
  'widget',
  'play',
  'page',
  'playground',
]
const LOG_LEVELS: readonly AiScriptLogLevel[] = ['print', 'error', 'system']

/**
 * `aiscript.logs` — 全 AiScript 実行文脈の実行結果 (print / エラー /
 * ライフサイクル) を AI が読み取る (#710)。#553 の構文 validate ループの
 * 実行時版で、「AI が書く → 保存で実行 → 結果を読んで修正」を閉じる。
 */
export const aiscriptLogsCapability = implement('aiscript.logs', {
  execute: (params) => {
    const source = LOG_SOURCE_KINDS.includes(
      params?.source as AiScriptSourceKind,
    )
      ? (params?.source as AiScriptSourceKind)
      : 'all'
    const sourceId =
      typeof params?.sourceId === 'string' && params.sourceId.length > 0
        ? params.sourceId
        : undefined
    const level = LOG_LEVELS.includes(params?.level as AiScriptLogLevel)
      ? (params?.level as AiScriptLogLevel)
      : 'all'
    const limit = typeof params?.limit === 'number' ? params.limit : 50
    return useAiScriptLogsStore().recent({ source, sourceId, level, limit })
  },
})

export const AISCRIPT_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiscriptValidateCapability,
  aiscriptLogsCapability,
]

/**
 * `plugins.create` / `plugins.update` / `widgets.create` / `widgets.update` の
 * preflight 用ヘルパ。params.src を AiScript として validate し、構文エラーが
 * あれば PreflightFailure を返す。dispatcher は確認ダイアログを出さずに AI へ
 * diagnostics を tool_result で返す (= AI 内ループで自動修復させる)。
 */
export function preflightValidateSrc(
  params: Record<string, unknown> | undefined,
  entryPoint: 'plugin' | 'widget',
): PreflightFailure | null {
  if (typeof params?.src !== 'string') return null
  const result = validateAiScript(params.src, { entryPoint })
  if (result.ok) return null
  return {
    error:
      'AiScript の構文エラーがあります。diagnostics を読んで src を修正し、' +
      '修正後の src で再度この capability を呼び出してください。\n' +
      `diagnostics: ${JSON.stringify(result.diagnostics)}`,
  }
}
