import { watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { commands } from '@/utils/tauriInvoke'

/**
 * 通知を配る main チャンネルは、カラムではなく口座セッションが全口座について張る
 * (#330 §3.1)。起動時と口座の追加は Rust が張る。フロントは復帰の信号 (スリープ
 * 復帰 / 端末の再開 / オフラインモードの解除) で張り直しを 1 本だけ頼む。
 * カラムごとの再接続 (JS 側のリスナーの張り直し) はそのまま各カラムが行う。
 */
export function useMainStreamKeeper(): void {
  const uiStore = useUiStore()
  watch(
    () => uiStore.deckResumeSignal,
    () => {
      commands.streamSubscribeMainAll().catch(() => {
        // Rust 側の再接続ループに委ねる。失敗しても次の復帰で頼み直す
      })
    },
  )
}
