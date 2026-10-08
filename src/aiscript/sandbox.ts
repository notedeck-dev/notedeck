import type { Ast, Interpreter } from '@syuilo/aiscript'
import type { Value } from '@syuilo/aiscript/interpreter/value.js'
import type { JsonValue } from '@/bindings'
import { useCommandStore } from '@/commands/registry'
import type { Principal } from '@/permissions/principal'
import { providerFromPrincipal } from '@/plugins/registrationId'
import { useToast } from '@/stores/toast'
import { commands, unwrap } from '@/utils/tauriInvoke'
import {
  type AiScriptEnvOptions,
  type AiScriptGlobalConstants,
  createAiScriptEnv,
} from './api'
import {
  type AiScriptIOCallbacks,
  createAiScriptInterpreter,
  createInterpreterOptions,
  execAiScript,
} from './common'
import {
  cleanupNoteDeckEnv,
  createNoteDeckEnv,
  type NoteDeckEnvContext,
} from './notedeck-api'
import { createAiScriptUiLib, type UiCallbacks } from './ui'

export interface AiScriptSandboxOptions {
  /**
   * 実行コードの principal (#712 §5.5 / #1099)。Mk:api の endpoint gate、
   * Nd:call / Nd:http の dispatcher 判定、登録 ID の名前空間がすべてここから
   * 決まる。省略できない — principal を決められない実行文脈は sandbox を
   * 組めない (型で強制)
   */
  principal: Principal
  /**
   * 登録 ID の名前空間に使うストア配布物の id (MisStore 由来のプラグイン /
   * ウィジェット)。未指定なら principal から導出する
   */
  storeId?: string
  /**
   * Mk:api / Nd:call のアカウント文脈。関数なら呼び出しのたびに評価する
   * (プラグインは handler 実行中だけ文脈を持つ, #821)。null / 未指定の間は
   * Mk:api が fail-closed になる
   */
  accountId?: string | null | (() => string | null)
  /** Mk:api の実装の差し替え (テスト用)。未指定なら accountId で apiRequest する */
  api?: AiScriptEnvOptions['api']
  /** localStorage のキー prefix (Mk:save / Mk:load) */
  storagePrefix?: string
  /** AiScript のグローバル定数 (THIS_ID / USER_* 等) */
  globals?: AiScriptGlobalConstants
  onDialog?: AiScriptEnvOptions['onDialog']
  onConfirm?: AiScriptEnvOptions['onConfirm']
  /** 未指定なら toast store に流す (無言の no-op にしない) */
  onToast?: AiScriptEnvOptions['onToast']
  /** 指定すると Ui:* を組み込む (ウィジェット / Play / Page / スクラッチパッド) */
  ui?: UiCallbacks
  io: AiScriptIOCallbacks
  /**
   * 既定 true。長寿命の interpreter 1 つに handler を登録する構造 (プラグイン) は
   * false — handler が 1 回エラーを出しただけで interpreter を止めない
   */
  abortOnError?: boolean
  /** 0.19 interpreter で動かす (Play の旧スクリプト専用) */
  legacy?: boolean
  /**
   * principal 固有の追加 env (Plugin:* 等)。Mk:* より優先し、Nd:* / Ui:* には
   * 上書きされる。`callers` はこの env の登録 capability を実行中の呼び出し元
   * (#1099) で、Mk:api / Nd:* と同じ配列
   */
  extraEnv?: (ctx: {
    principal: Principal
    callers: readonly Principal[]
  }) => Record<string, Value>
}

export interface AiScriptSandbox {
  interpreter: Interpreter
  /** interpreter に渡した env (Mk:* / 追加 env / Nd:* / Ui:* を重ねた後) */
  env: Record<string, Value>
  /** Nd:* の文脈。登録の解除や interpreter の参照を持つ */
  ndCtx: NoteDeckEnvContext
  /** パース済み AST を実行する (legacy 対応) */
  exec(ast: Ast.Node[]): Promise<void>
  /** interpreter を止め、この env が行った登録をすべて解除する */
  dispose(): void
}

/**
 * AiScript の実行環境 (Mk:* / Nd:* / Ui:* + interpreter) を 1 箇所で組む
 * (#1099 段階 C / #1098 §4)。プラグイン / ウィジェット / Play / Page /
 * スクラッチパッドはすべてここを通り、principal を 1 回だけ渡す。
 *
 * - Mk:api と Nd:* は同じ principal と同じ `callers` 配列を見る
 *   (呼び出し元 ∩ 実行体の AND 判定が両方で揃う)
 * - 登録の名前空間 (provider) も同じ principal から導く
 */
export function createAiScriptSandbox(
  options: AiScriptSandboxOptions,
): AiScriptSandbox {
  const { principal, accountId } = options
  const getAccountId =
    typeof accountId === 'function' ? accountId : () => accountId ?? null

  const api: AiScriptEnvOptions['api'] =
    options.api ??
    (async (endpoint, params) => {
      const accountId = getAccountId()
      if (!accountId) {
        throw new Error('Mk:api: no account context available')
      }
      return unwrap(
        await commands.apiRequest(accountId, endpoint, params as JsonValue),
      )
    })

  // この env の登録 capability を実行中の呼び出し元 (#1099) — Mk:api と
  // Nd:* が同じ配列を見る
  const callers: Principal[] = []
  const mkEnv = createAiScriptEnv(
    {
      principal,
      getCallers: () => callers,
      api,
      storagePrefix: options.storagePrefix,
      onDialog: options.onDialog,
      onConfirm: options.onConfirm,
      onToast: options.onToast ?? ((text, type) => useToast().show(text, type)),
    },
    options.globals,
  )
  const extraEnv = options.extraEnv?.({ principal, callers }) ?? {}

  const ndCtx: NoteDeckEnvContext = {
    commandStore: useCommandStore(),
    principal,
    provider: providerFromPrincipal(principal, options.storeId),
    disposers: [],
    callers,
    getAccountId,
  }
  const ndEnv = createNoteDeckEnv(ndCtx)
  const uiEnv = options.ui ? createAiScriptUiLib(options.ui) : {}

  const ioOpts = {
    ...createInterpreterOptions(options.io),
    abortOnError: options.abortOnError ?? true,
  }
  const legacy = options.legacy ?? false
  const env = { ...mkEnv, ...extraEnv, ...ndEnv, ...uiEnv }
  const interpreter = createAiScriptInterpreter(env, ioOpts, legacy)
  ndCtx.interpreter = interpreter

  return {
    interpreter,
    env,
    ndCtx,
    exec: (ast) => execAiScript(interpreter, ast, legacy),
    dispose: () => {
      interpreter.abort()
      cleanupNoteDeckEnv(ndCtx)
    },
  }
}
