import { getCurrentScope, onScopeDispose, type Ref, ref } from 'vue'

/**
 * 相対時刻 (「3 分前」) 用の共有の時計。購読者が何人いてもタイマーは 1 本で、
 * 壁時計の分の境目ごとに now を進める。最後の購読者のスコープが閉じたら止める。
 *
 * 行ごとに setInterval を持たせると、タイムラインの行数ぶんタイマーが並び、
 * それぞれ違う瞬間に再描画が起きる。1 本にまとめて同じフレームで更新する。
 */
const now = ref(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setTimeout> | null = null

function schedule(): void {
  // setInterval(60s) だと購読開始の秒に揃ってしまう。分の境目の少し後に合わせる
  timer = setTimeout(
    () => {
      now.value = Date.now()
      schedule()
    },
    60_000 - (Date.now() % 60_000) + 50,
  )
}

export function useMinuteClock(): Readonly<Ref<number>> {
  // スコープの外では解除できないので、購読せず今の値だけ返す
  if (!getCurrentScope()) return now
  if (subscribers++ === 0) {
    now.value = Date.now()
    schedule()
  }
  onScopeDispose(() => {
    if (--subscribers === 0 && timer) {
      clearTimeout(timer)
      timer = null
    }
  })
  return now
}
