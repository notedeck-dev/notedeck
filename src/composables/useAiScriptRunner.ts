import type { Ast, Interpreter } from '@syuilo/aiscript'
import { onScopeDispose, ref } from 'vue'
import type { AiScriptGlobalConstants } from '@/aiscript/api'
import { parseAiScript } from '@/aiscript/common'
import { type AiScriptSandbox, createAiScriptSandbox } from '@/aiscript/sandbox'
import { sanitizeCode } from '@/aiscript/sanitize'
import type { UiComponent } from '@/aiscript/ui'
import type AiScriptDialog from '@/components/common/AiScriptDialog.vue'
import type { Principal } from '@/permissions/principal'
import {
  logSourceOfPrincipal,
  useAiScriptLogsStore,
} from '@/stores/aiscriptLogs'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'

export interface AiScriptRunOptions {
  /**
   * 実行コードの principal (#712 §5.5)。Play / Page はサーバー由来の第三者
   * コードなので `{ kind: 'plugin', pluginId: 'play:<id>' }` 等を渡す。
   */
  principal: Principal
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
 * AiScript 実行のセットアップ (parse → sandbox → exec) と実行状態の reactive な
 * 写しを担当する composable。環境の組み立ては `createAiScriptSandbox` 1 本。
 *
 * Play / Page 詳細ウィンドウから共通利用する。
 */
export function useAiScriptRunner() {
  const interpreter = ref<Interpreter | null>(null)
  const consoleOutput = ref<{ text: string; isError: boolean }[]>([])
  const uiComponents = ref<UiComponent[]>([])
  const runError = ref<string | null>(null)
  const running = ref(false)

  const { show: showToast } = useToast()
  let currentSandbox: AiScriptSandbox | null = null

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

    const logSource = logSourceOfPrincipal(options.principal)
    const runLog = useAiScriptLogsStore().beginRun(
      logSource.source,
      logSource.sourceId,
      logSource.name,
    )

    const sanitized = sanitizeCode(code)

    let ast: Ast.Node[]
    let legacy: boolean
    try {
      const result = parseAiScript(sanitized)
      ast = result.ast
      legacy = result.legacy
    } catch (e) {
      runError.value = AppError.from(e).message
      runLog.system(`parse error: ${AppError.from(e).message}`)
      running.value = false
      return
    }

    currentSandbox?.dispose()
    const sandbox = createAiScriptSandbox({
      principal: options.principal,
      accountId: options.accountId,
      storagePrefix: options.storagePrefix,
      globals: options.globals,
      onDialog: (title, text, type) =>
        options.dialog?.()?.showDialog(title, text, type) ?? Promise.resolve(),
      onConfirm: (title, text) =>
        options.dialog?.()?.showConfirm(title, text) ?? Promise.resolve(false),
      onToast: (text, type) => showToast(text, type),
      ui: {
        onRender: (components) => {
          uiComponents.value = components
        },
      },
      io: {
        onOutput: (text) => {
          consoleOutput.value.push({ text, isError: false })
          runLog.print(text)
        },
        onError: (err) => {
          runError.value = err.message
          runLog.error(err.message)
        },
      },
      legacy,
    })
    currentSandbox = sandbox
    interpreter.value = sandbox.interpreter
    try {
      await sandbox.exec(ast)
      runLog.system('run completed')
    } catch (e) {
      runError.value = AppError.from(e).message
      runLog.system(`run aborted: ${AppError.from(e).message}`)
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
    currentSandbox?.dispose()
    currentSandbox = null
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
