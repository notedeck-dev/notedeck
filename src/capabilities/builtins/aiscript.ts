import { validateAiScript } from '@/aiscript/validate'
import type { Command, PreflightFailure } from '@/commands/registry'
import {
  type AiScriptLogLevel,
  type AiScriptSourceKind,
  useAiScriptLogsStore,
} from '@/stores/aiscriptLogs'

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
export const aiscriptLogsCapability: Command = {
  id: 'aiscript.logs',
  label: 'AiScript 実行ログを取得',
  icon: 'ti-bug',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['logs.read'],
  signature: {
    description:
      'AiScript (プラグイン/ウィジェット/Play/Page/スクラッチパッド) の実行ログ' +
      'を新しい順に返す。print 出力は level "print"、実行時エラーは "error"、' +
      '起動 (started)・正常終了 (run completed)・parse 失敗・runtime abort は' +
      ' "system"。プラグイン/ウィジェットを保存して実行された後は必ずこれを' +
      ' source / sourceId で絞って確認し、error や parse 失敗があれば src を' +
      '修正して再保存するループを回すこと。3 回試して直らないならログを' +
      'ユーザーに見せて相談する。',
    params: {
      source: {
        type: 'string',
        description:
          '"plugin" | "widget" | "play" | "page" | "playground" | "all" (default: "all")',
        enum: [...LOG_SOURCE_KINDS, 'all'],
        optional: true,
      },
      sourceId: {
        type: 'string',
        description:
          'installId (plugin/widget) や Play/Page の id で絞り込む (省略可)',
        optional: true,
      },
      level: {
        type: 'string',
        description: '"print" | "error" | "system" | "all" (default: "all")',
        enum: [...LOG_LEVELS, 'all'],
        optional: true,
      },
      limit: {
        type: 'number',
        description: '最大返却数 (default: 50)',
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description:
        '{ at, source, sourceId, name?, runId, level, message } の配列 (新しい順)。' +
        'runId は実行ごとの通し番号で、同じ runId = 同じ実行。',
    },
    cheap: true,
  },
  visible: false,
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
}

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
