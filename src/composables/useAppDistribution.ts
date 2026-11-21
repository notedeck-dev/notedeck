/**
 * このアプリがどの経路で配られたものか (#849)。Microsoft Store 版は Store が更新し、
 * ログイン時の起動も今は登録できないので、「自分で自分を更新・登録する」操作を出さない。
 * プロセスの間は変わらないので 1 回だけ聞く。
 *
 * 答えが出るまで (と、聞けなかったとき) は `unknown` で、自分で更新・登録する操作は出さない。
 * `direct` を初期値にすると、Store 版でも答えが届くまで自動起動のメニューが出てしまう。
 */
import { computed, ref } from 'vue'
import { type AppDistribution, commands } from '@/bindings'
import { isTauri } from '@/utils/settingsFs'

// ブラウザ (開発用のダッシュボード) には配布の形態が無い。直接配布版と同じ扱いにする
const distribution = ref<AppDistribution>(isTauri ? 'unknown' : 'direct')
let resolved: Promise<AppDistribution> | undefined

/** 答えが出るのを待つ。聞けなかったときは `unknown` */
export function resolveAppDistribution(): Promise<AppDistribution> {
  if (!resolved) {
    resolved = isTauri
      ? commands
          .appDistribution()
          .catch((): AppDistribution => 'unknown')
          .then((d) => {
            distribution.value = d
            return d
          })
      : Promise.resolve(distribution.value)
  }
  return resolved
}

export function useAppDistribution() {
  void resolveAppDistribution()
  return {
    distribution,
    /** 更新の確認や自動起動の登録を、アプリ自身が行える配布形態か */
    managesItself: computed(() => distribution.value === 'direct'),
    isMicrosoftStore: computed(() => distribution.value === 'microsoftStore'),
  }
}
