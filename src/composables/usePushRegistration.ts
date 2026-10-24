import { type MaybeRefOrGetter, ref, toValue } from 'vue'
import type {
  PushDistributor,
  PushHostStatus,
  PushProblem,
  PushState,
} from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * サーバー単位の push の登録 (#330、Android)。本家の購読登録はアプリのトークンでは
 * 呼べないので、準備 (prepare) で NoteDeck がレジストリに送り先を書き、利用者は状態に
 * 載ってくるコードを本家 Web のスクラッチパッドで ▶ するだけ。応答の貼り戻しは無く、
 * 確定は届いた push で Rust 側が行う。窓は `refresh` を読み直して進み具合を出す。
 *
 * 準備がうまくいかない理由は `problem` に入る (例外にしない)。IPC そのものの失敗
 * (通信できない等) は `error` に入る。
 */
export function usePushRegistration(host: MaybeRefOrGetter<string>) {
  const status = ref<PushHostStatus | null>(null)
  const problem = ref<PushProblem | null>(null)
  const error = ref<unknown>(null)
  const busy = ref(false)
  let refreshing = false

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

  /** 状態を読み直す。読み直しが重なったら後の方は捨てる (数秒おきに呼ばれる) */
  async function refresh() {
    if (refreshing) return
    refreshing = true
    try {
      status.value = unwrap(await commands.pushHostStatus(toValue(host)))
    } catch (e) {
      error.value = e
    } finally {
      refreshing = false
    }
  }

  async function settle(task: () => Promise<PushProblem | null>) {
    problem.value = null
    const result = await run(task)
    if (result === undefined) return
    problem.value = result
    await refresh()
  }

  /** サーバーの口座をまとめて準備する */
  function prepare() {
    return settle(async () => unwrap(await commands.pushPrepare(toValue(host))))
  }

  /** 口座の登録を作り直す */
  function redo(accountId: string) {
    return settle(async () => unwrap(await commands.pushRedo(accountId)))
  }

  async function disable(accountId: string) {
    const done = await run(async () => {
      unwrap(await commands.pushDisable(accountId))
      return true
    })
    // 失敗したら読み直さない (読み直しが error を消さないよう、ここで止める)
    if (!done) return
    await refresh()
  }

  /** 入っているプッシュ通知アプリ (OS の選択画面を出せなかったとき) */
  async function distributors(): Promise<PushDistributor[]> {
    return (
      (await run(async () => unwrap(await commands.pushDistributors()))) ?? []
    )
  }

  /** プッシュ通知アプリを決めて、準備をやり直す */
  async function choose(packageName: string) {
    const done = await run(async () => {
      unwrap(await commands.pushChooseDistributor(packageName))
      return true
    })
    if (done) await prepare()
  }

  return {
    status,
    problem,
    error,
    busy,
    refresh,
    prepare,
    redo,
    disable,
    distributors,
    choose,
  }
}

/** 口座の push の状態 (アカウントメニューの状態行。ネットワークに出ない) */
export function usePushState(accountId: MaybeRefOrGetter<string>) {
  const state = ref<PushState | null>(null)

  async function refresh() {
    try {
      state.value = unwrap(await commands.pushStatus(toValue(accountId)))
    } catch {
      // 状態行は出さないだけ (定期確認の表示に倒れる)
      state.value = null
    }
  }

  return { state, refresh }
}
