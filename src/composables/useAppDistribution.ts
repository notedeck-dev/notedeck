/**
 * このアプリがどの経路で配られたものか (#849)。Microsoft Store 版は Store が更新し、
 * ログイン時の起動も今は登録できないので、「自分で自分を更新・登録する」操作を出さない。
 * プロセスの間は変わらないので 1 回だけ聞く。
 */
import { computed, ref } from 'vue'
import { type AppDistribution, commands } from '@/bindings'
import { isTauri } from '@/utils/settingsFs'

const distribution = ref<AppDistribution>('direct')
let started = false

function start(): void {
  if (started || !isTauri) return
  started = true
  void commands
    .appDistribution()
    .then((d) => {
      distribution.value = d
    })
    .catch(() => undefined)
}

export function useAppDistribution() {
  start()
  return {
    distribution,
    /** 更新の確認や自動起動の登録を、アプリ自身が行える配布形態か */
    managesItself: computed(() => distribution.value === 'direct'),
    isMicrosoftStore: computed(() => distribution.value === 'microsoftStore'),
  }
}
