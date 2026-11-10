import { type Ast, Interpreter, Parser, utils } from '@syuilo/aiscript'
import type { Value } from '@syuilo/aiscript/interpreter/value.js'
import {
  Interpreter as LegacyInterpreter,
  Parser as LegacyParser,
} from '@syuilo/aiscript-0-19-0'

export interface AiScriptIOCallbacks {
  onOutput: (text: string) => void
  onError: (error: Error) => void
  /**
   * 止まらずに値で返した失敗の記録 (Mk:api の request_failed、#1249)。エラー表示
   * にはせず、実行ログに残す
   */
  onNotice?: (text: string) => void
}

/**
 * Interpreter コンストラクタの第2引数を生成する。
 * maxStep, abortOnError, irqRate の共通値を1箇所に集約。
 */
export function createInterpreterOptions(callbacks: AiScriptIOCallbacks) {
  return {
    out: (val: Value) => {
      callbacks.onOutput(utils.reprValue(val))
    },
    err: (e: Error) => {
      callbacks.onError(e)
    },
    maxStep: 100000,
    abortOnError: true,
    irqRate: 300,
  }
}

export function isLegacyScript(code: string): boolean {
  const version = utils.getLangVersion(code)
  if (version == null) return true
  const [major] = version.split('.').map(Number)
  return (major ?? 0) < 1
}

export function parseAiScript(code: string): {
  ast: Ast.Node[]
  legacy: boolean
} {
  const legacy = isLegacyScript(code)
  if (legacy) {
    const legacyParser = new LegacyParser()
    const ast = legacyParser.parse(code) as unknown as Ast.Node[]
    return { ast, legacy }
  }
  const parser = new Parser()
  const ast = parser.parse(code)
  return { ast, legacy }
}

/**
 * コールバック実行 (execFn / execFnSync) のたびに stepCount をリセットする。
 * stepCount は interpreter インスタンスの生涯累積で、Async:interval や
 * UI イベントハンドラの実行分も同じカウンタを消費するため、これがないと
 * 常駐スクリプトが時間経過で必ず MaxStepExceeded になる (#733)。
 * maxStep 本来の目的 (1回の実行の暴走防止) は維持される。
 *
 * aiscript の autobind は初回 get で own property にキャッシュし、set は
 * prototype 側の共有クロージャを書き換える (全インスタンスに波及する) ため、
 * 必ず get してから own property を上書きすること。
 */
function resetStepCountPerCallback(interp: Interpreter): void {
  const origExecFn = interp.execFn
  interp.execFn = (fn, args) => {
    interp.stepCount = 0
    return origExecFn(fn, args)
  }
  // legacy interpreter (0.19) には execFnSync がない
  const origExecFnSync = interp.execFnSync as
    | Interpreter['execFnSync']
    | undefined
  if (typeof origExecFnSync === 'function') {
    interp.execFnSync = (fn, args) => {
      interp.stepCount = 0
      return origExecFnSync(fn, args)
    }
  }
}

export function createAiScriptInterpreter(
  env: Record<string, Value>,
  ioOpts: ReturnType<typeof createInterpreterOptions>,
  legacy: boolean,
): Interpreter {
  const interp = legacy
    ? (new LegacyInterpreter(
        env as Record<string, never>,
        ioOpts as unknown as ConstructorParameters<typeof LegacyInterpreter>[1],
      ) as unknown as Interpreter)
    : new Interpreter(env, ioOpts)
  resetStepCountPerCallback(interp)
  return interp
}

export async function execAiScript(
  interpreter: Interpreter,
  ast: Ast.Node[],
  legacy: boolean,
): Promise<void> {
  if (legacy) {
    const interp = interpreter as unknown as LegacyInterpreter
    await interp.exec(ast as unknown as Parameters<typeof interp.exec>[0])
  } else {
    await interpreter.exec(ast)
  }
}
