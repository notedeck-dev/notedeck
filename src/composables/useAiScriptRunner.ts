import type { Ast, Interpreter } from '@syuilo/aiscript'
import { onScopeDispose, ref } from 'vue'
import { type AiScriptGlobalConstants, createAiScriptEnv } from '@/aiscript/api'
import {
  createAiScriptInterpreter,
  createInterpreterOptions,
  execAiScript,
  parseAiScript,
} from '@/aiscript/common'
import {
  cleanupNoteDeckEnv,
  createNoteDeckEnv,
  type NoteDeckEnvContext,
} from '@/aiscript/notedeck-api'
import { sanitizeCode } from '@/aiscript/sanitize'
import { createAiScriptUiLib, type UiComponent } from '@/aiscript/ui'
import type { JsonValue } from '@/bindings'
import { useCommandStore } from '@/commands/registry'
import type AiScriptDialog from '@/components/common/AiScriptDialog.vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface AiScriptRunOptions {
  /** 実行対象のアカウント ID (Mk:api の呼び出し先) */
  accountId: string
  /** localStorage キーの prefix (例: `play-${id}` / `page-${id}`) */
  storagePrefix: string
  /** AiScript のグローバル定数 (THIS_ID / THIS_URL / USER_* 等) */
  globals: AiScriptGlobalConstants
  /** AiScriptDialog インスタンスへの遅延参照。Mk:dialog / Mk:confirm で使用 */
  dialog?: () => InstanceType<typeof AiScriptDialog> | null
}

/**
 * AiScript 実行のセットアップ (parse → env → ui → interpreter → exec) と
 * Nd:* / Mk:* / Ui:* の context 管理を一括で担当する composable。
 *
 * Play / Page 詳細ウィンドウや将来の AiScript 実行箇所から共通利用する。
 */
export function useAiScriptRunner() {
  const interpreter = ref<Interpreter | null>(null)
  const consoleOutput = ref<{ text: string; isError: boolean }[]>([])
  const uiComponents = ref<UiComponent[]>([])
  const runError = ref<string | null>(null)
  const running = ref(false)

  const commandStore = useCommandStore()
  const { config: aiConfig } = useAiConfig()
  const { show: showToast } = useToast()
  let currentNdCtx: NoteDeckEnvContext | null = null

  function reset() {
    runError.value = null
    uiComponents.value = []
    consoleOutput.value = []
    running.value = false
    if (interpreter.value) {
      interpreter.value.abort()
      interpreter.value = null
    }
  }

  async function run(code: string, options: AiScriptRunOptions): Promise<void> {
    reset()
    running.value = true

    const sanitized = sanitizeCode(code)

    let ast: Ast.Node[]
    let legacy: boolean
    try {
      const result = parseAiScript(sanitized)
      ast = result.ast
      legacy = result.legacy
    } catch (e) {
      runError.value = AppError.from(e).message
      running.value = false
      return
    }

    const apiOption = async (
      endpoint: string,
      params: Record<string, unknown>,
    ) => {
      return unwrap(
        await commands.apiRequest(
          options.accountId,
          endpoint,
          params as JsonValue,
        ),
      )
    }

    const env = createAiScriptEnv(
      {
        api: apiOption,
        storagePrefix: options.storagePrefix,
        onDialog: (title, text, type) =>
          options.dialog?.()?.showDialog(title, text, type) ??
          Promise.resolve(),
        onConfirm: (title, text) =>
          options.dialog?.()?.showConfirm(title, text) ??
          Promise.resolve(false),
        onToast: (text, type) => showToast(text, type),
      },
      options.globals,
    )

    const ui = createAiScriptUiLib({
      onRender: (components) => {
        uiComponents.value = components
      },
    })

    const ioOpts = createInterpreterOptions({
      onOutput: (text) => consoleOutput.value.push({ text, isError: false }),
      onError: (err) => {
        runError.value = err.message
      },
    })

    if (currentNdCtx) cleanupNoteDeckEnv(currentNdCtx)
    const ndCtx: NoteDeckEnvContext = {
      commandStore,
      getAiConfig: () => aiConfig.value,
      registeredCommandIds: [],
      subscriptions: [],
    }
    const ndEnv = createNoteDeckEnv(ndCtx)
    currentNdCtx = ndCtx

    const interp = createAiScriptInterpreter(
      { ...env, ...ndEnv, ...ui },
      ioOpts,
      legacy,
    )
    ndCtx.interpreter = interp
    interpreter.value = interp
    try {
      await execAiScript(interp, ast, legacy)
    } catch (e) {
      runError.value = AppError.from(e).message
    }
    running.value = false
  }

  function abort() {
    if (interpreter.value) {
      interpreter.value.abort()
      interpreter.value = null
    }
  }

  function cleanup() {
    abort()
    if (currentNdCtx) {
      cleanupNoteDeckEnv(currentNdCtx)
      currentNdCtx = null
    }
  }

  onScopeDispose(() => {
    cleanup()
  })

  return {
    interpreter,
    consoleOutput,
    uiComponents,
    runError,
    running,
    run,
    reset,
    abort,
    cleanup,
  }
}
