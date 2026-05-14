import { validateAiScript } from '@/aiscript/validate'
import type { Command, PreflightFailure } from '@/commands/registry'

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

export const aiscriptValidateCapability: Command = {
  id: 'aiscript.validate',
  label: 'AiScript を構文検証する',
  icon: 'ti-check',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      'AiScript ソースを構文検証し、エラー一覧を返す。プラグイン/ウィジェット' +
      'を `plugins.create` / `plugins.update` / `widgets.create` / `widgets.update`' +
      'で保存する前に必ず通して、diagnostics が空でなければ src を修正して再度' +
      'validate するループを回すこと。3 回試して直らないなら diagnostics を' +
      'ユーザーに見せて相談する。',
    params: {
      src: { type: 'string', description: 'AiScript ソースコード' },
      entryPoint: {
        type: 'string',
        description: "'plugin' | 'widget' (省略可)",
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description:
        '{ ok: boolean, diagnostics: Array<{severity, message, line, column, endLine, endColumn}> }' +
        '。line / column は 1-based。',
    },
    cheap: true,
  },
  visible: false,
  execute: (params) => {
    const src = typeof params?.src === 'string' ? params.src : null
    if (src === null) throw new Error('aiscript.validate: src is required')
    const entryPoint =
      params?.entryPoint === 'plugin' || params?.entryPoint === 'widget'
        ? params.entryPoint
        : undefined
    return validateAiScript(src, { entryPoint })
  },
}

export const AISCRIPT_BUILTIN_CAPABILITIES: readonly Command[] = [
  aiscriptValidateCapability,
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
