import { values } from '@syuilo/aiscript'
import type { VFn } from '@syuilo/aiscript/interpreter/value.js'
import { describe, expect, it } from 'vitest'
import {
  createAiScriptInterpreter,
  createInterpreterOptions,
  execAiScript,
  parseAiScript,
} from './common'

// Note: #733 — stepCount は interpreter インスタンスの生涯累積のため、
// Async:interval コールバック等の繰り返し実行で maxStep に達し
// 常駐ウィジェットが時間経過でエラー死していた。
// コールバック実行 (execFn / execFnSync) ごとにリセットされることを検証する。

const CODE = `/// @ 1.2.1
@heavy() {
  var i = 0
  for 20000 {
    i += 1
  }
  i
}
capture(heavy)
`

async function setupHeavyCallback() {
  const errors: Error[] = []
  let captured: VFn | null = null
  const env = {
    capture: values.FN_NATIVE(([fn]) => {
      captured = fn as VFn
      return values.NULL
    }),
  }
  const ioOpts = createInterpreterOptions({
    onOutput: () => undefined,
    onError: (e) => errors.push(e),
  })
  const { ast, legacy } = parseAiScript(CODE)
  expect(legacy).toBe(false)
  const interp = createAiScriptInterpreter(env, ioOpts, legacy)
  await execAiScript(interp, ast, legacy)
  expect(captured).not.toBeNull()
  return { interp, captured: captured as unknown as VFn, errors }
}

describe('createAiScriptInterpreter stepCount reset (#733)', () => {
  // async 実行は irqRate ごとに macrotask へ yield するため実時間がかかる
  it('execFn の繰り返し呼び出しで stepCount が累積せず maxStep を超えない', {
    timeout: 30000,
  }, async () => {
    const { interp, captured, errors } = await setupHeavyCallback()

    await interp.execFn(captured, [])
    const stepsPerCall = interp.stepCount
    // 1回の実行では maxStep(100000) に届かないが、累積すれば必ず超える規模
    expect(stepsPerCall).toBeGreaterThan(10000)
    expect(stepsPerCall).toBeLessThan(100000)

    const calls = Math.ceil(200000 / stepsPerCall)
    for (let i = 0; i < calls; i++) {
      await interp.execFn(captured, [])
    }
    expect(errors).toEqual([])
  })

  it('execFnSync の繰り返し呼び出しで stepCount が累積せず maxStep を超えない', async () => {
    const { interp, captured, errors } = await setupHeavyCallback()

    interp.execFnSync(captured, [])
    const stepsPerCall = interp.stepCount
    expect(stepsPerCall).toBeGreaterThan(10000)
    expect(stepsPerCall).toBeLessThan(100000)

    const calls = Math.ceil(200000 / stepsPerCall)
    for (let i = 0; i < calls; i++) {
      interp.execFnSync(captured, [])
    }
    expect(errors).toEqual([])
  })

  // 実際に問題が起きた経路: Async:interval は aiscript 内部で
  // opts.topCall (= interp.execFn) を呼ぶため、ラッパーが効くことを検証する
  it('Async:interval コールバックの累積で maxStep を超えない', {
    timeout: 30000,
  }, async () => {
    const errors: Error[] = []
    let ticks = 0
    const env = {
      tick: values.FN_NATIVE(() => {
        ticks++
        return values.NULL
      }),
    }
    const ioOpts = createInterpreterOptions({
      onOutput: () => undefined,
      onError: (e) => errors.push(e),
    })
    const code = `/// @ 1.2.1
Async:interval(1, @() {
  var j = 0
  for 8000 {
    j += 1
  }
  tick()
})
`
    const { ast, legacy } = parseAiScript(code)
    const interp = createAiScriptInterpreter(env, ioOpts, legacy)
    await execAiScript(interp, ast, legacy)

    // 1 tick ≒ 24000+ steps なので 5 tick で累積 100000 を確実に超える
    await new Promise<void>((resolve) => {
      const handle = setInterval(() => {
        if (ticks >= 5 || errors.length > 0) {
          clearInterval(handle)
          resolve()
        }
      }, 50)
    })
    interp.abort()

    expect(errors).toEqual([])
    expect(ticks).toBeGreaterThanOrEqual(5)
  })
})
