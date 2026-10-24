import { ref } from 'vue'
import type { PushOverview, PushProblem } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * push の設定 (#330、Android)。プッシュ通知アプリの選択は端末で 1 つ、オン / オフは
 * アカウントごと。本家の購読登録はアプリのトークンでは呼べないので、オンにすると
 * NoteDeck がレジストリに送り先を書き、利用者はサーバーごとに状態へ載ってくるコードを
 * 本家 Web のスクラッチパッドで ▶ するだけ。応答の貼り戻しは無く、確定は届いた push で
 * Rust 側が行う。窓は `refresh` を読み直して進み具合を出す。
 *
 * 準備がうまくいかない理由は `problem` に入る (例外にしない)。IPC そのものの失敗
 * (通信できない等) は `error` に入る。
 */
export function usePushRegistration() {
  const status = ref<PushOverview | null>(null)
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
      status.value = unwrap(await commands.pushOverview())
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

  /** 最後にオンにしようとした口座 (プッシュ通知アプリを選んだ後にやり直す) */
  let lastTarget: string | null = null

  /** 口座をオンにする (未実行の登録待ちが同じサーバーにあれば、まとめて 1 つのコードにする) */
  function prepare(accountId: string) {
    lastTarget = accountId
    return settle(async () => unwrap(await commands.pushPrepare(accountId)))
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

  /**
   * 使うプッシュ通知アプリを決める。選べなくて止まっていたオンの操作は、選んだ後に
   * やり直す
   */
  async function choose(packageName: string) {
    const retry = problem.value === 'chooseDistributor'
    const done = await run(async () => {
      unwrap(await commands.pushChooseDistributor(packageName))
      return true
    })
    if (!done) return
    if (retry && lastTarget) await prepare(lastTarget)
    else await refresh()
  }

  return {
    status,
    problem,
    error,
    busy,
    refresh,
    prepare,
    disable,
    choose,
  }
}
