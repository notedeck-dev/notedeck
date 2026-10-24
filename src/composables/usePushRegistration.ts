import { type MaybeRefOrGetter, ref, toValue } from 'vue'
import type { PushPrepared, PushProblem, PushStatus } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * 口座ごとの push の登録 (#330 §5、Android)。本家の購読登録はアプリのトークンでは
 * 呼べないので、準備 (prepare) で受け取ったコードを利用者に本家 Web の Scratchpad で
 * 実行してもらい、応答を貼ってもらって確定 (complete) する。
 *
 * 準備や確定がうまくいかない理由は `problem` に入る (例外にしない)。IPC そのものの
 * 失敗 (通信できない等) は `error` に入る。確定に失敗してもコードは残す (貼り直せる)。
 */
export function usePushRegistration(accountId: MaybeRefOrGetter<string>) {
  const status = ref<PushStatus | null>(null)
  const prepared = ref<PushPrepared | null>(null)
  const problem = ref<PushProblem | null>(null)
  const error = ref<unknown>(null)
  const busy = ref(false)

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    busy.value = true
    error.value = null
    try {
      return await task()
    } catch (e) {
      error.value = e
      return undefined
    } finally {
      busy.value = false
    }
  }

  async function refresh() {
    await run(async () => {
      status.value = unwrap(await commands.pushStatus(toValue(accountId)))
    })
  }

  async function prepare() {
    problem.value = null
    await run(async () => {
      const result = unwrap(await commands.pushPrepare(toValue(accountId)))
      prepared.value = result.prepared
      problem.value = result.problem
    })
  }

  /** 応答を貼って確定する。受け入れられたら true */
  async function complete(response: string): Promise<boolean> {
    problem.value = null
    const accepted = await run(async () => {
      const result = unwrap(
        await commands.pushComplete(toValue(accountId), response),
      )
      problem.value = result
      return result === null
    })
    if (!accepted) return false
    prepared.value = null
    await refresh()
    return true
  }

  async function disable() {
    const done = await run(async () => {
      unwrap(await commands.pushDisable(toValue(accountId)))
      return true
    })
    // 失敗したら読み直さない (読み直しの run が error を消してしまう)
    if (!done) return
    prepared.value = null
    await refresh()
  }

  return {
    status,
    prepared,
    problem,
    error,
    busy,
    refresh,
    prepare,
    complete,
    disable,
  }
}
