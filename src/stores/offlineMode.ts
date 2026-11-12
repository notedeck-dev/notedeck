import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { events } from '@/bindings'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { useStreamingStore } from '@/stores/streaming'
import { useSuspensionsStore } from '@/stores/suspensions'
import { useSystemStateStore } from '@/stores/systemState'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { isTauri } from '@/utils/settingsFs'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { useRepresentative } from '@/windows/roles'

/**
 * アプリ全体のオフラインモード。
 *
 * - 手動: 利用者が切り替える。この機械だけの状態で、Rust が専用のファイルに持つ
 *   (#1350)。回線が戻っても勝手には抜けない
 * - 自動 (#461): 回線が無いと `systemState` が判断したら入り、戻ったら抜ける。
 *   設定ファイルには書かない一時状態。自動で入っている間に利用者が解除したら、
 *   次に回線が切れるまで自動を抑止する (回線検知の誤りで閉じ込めない)
 *
 * 入る / 抜けるときの副作用 (ストリーム切断、輸送路の再適用、復帰信号) は
 * どちらの経路でも同じなので、実効値の watcher 1 箇所でやる。
 */
export const useOfflineModeStore = defineStore('offlineMode', () => {
  const systemState = useSystemStateStore()

  /** 手動のオフライン。正本は Rust が持つこの機械の状態 (`notecore::offline`) の写し */
  const manual = ref(false)
  const isManualOffline = computed(() => manual.value)

  let unlisten: (() => void) | null = null
  let eventGeneration = 0
  /**
   * 起動時に 1 回呼ぶ (初回の描画より前)。別の窓での切替を先に聞き始めてから今の値を
   * 取る (取りこぼし防止)。失敗しても reject しない
   */
  async function load(): Promise<void> {
    if (!isTauri || unlisten) return
    try {
      unlisten = await events.offlineModeChanged.listen(({ payload }) => {
        eventGeneration++
        manual.value = payload.offline
      })
      const before = eventGeneration
      const initial = unwrap(await commands.offlineModeGet())
      if (before === eventGeneration) manual.value = initial
    } catch (e) {
      console.warn('[offline] cannot read the manual flag:', e)
    }
  }

  /**
   * 手動のオフラインを切り替える。Rust が状態を書いて接続を切ってから画面に反映する。
   * 書けなかったら画面は変えず、失敗を見せる (画面はオフラインなのに通信は出たまま、を
   * 作らない)。戻り値は切り替わったか
   */
  async function setManual(next: boolean): Promise<boolean> {
    if (!isTauri) {
      // Web ビルドとテストには Rust が居ない。この窓の中だけで切り替える
      manual.value = next
      return true
    }
    try {
      unwrap(await commands.offlineModeSet(next))
      manual.value = next
      return true
    } catch (e) {
      useToast().show(
        i18n.tsx._offlineMode.switchFailed({
          error: AppError.from(e).message,
        }),
        'error',
      )
      return false
    }
  }

  /** 自動オフライン中に利用者が解除した。次の回線断で解ける */
  const autoSuppressed = ref(false)
  watch(
    () => systemState.adaptation.goOffline,
    (v) => {
      if (!v) autoSuppressed.value = false
    },
  )

  /** 回線が無いことによる自動のオフライン */
  const isAutoOffline = computed(
    () => systemState.adaptation.goOffline && !autoSuppressed.value,
  )

  /** 実効値: 手動 or 自動 */
  const isOfflineMode = computed(
    () => isManualOffline.value || isAutoOffline.value,
  )

  watch(
    isOfflineMode,
    (now) => {
      if (now) {
        void useStreamingStore().disconnectAll(useAccountsStore().accounts)
        return
      }
      // polling モードなら輸送路を再開する (#1004)。disconnectAll が polling
      // タスクも止めるため、再適用しないと復帰時の connect で実動作が
      // realtime に化ける。realtimeMode store を経由しないのは、そちらが
      // こちらの isOfflineMode を見る (向きを一方向に保つ、#1098)
      // 輸送路への適用はプロセスに 1 回でよいので代表窓だけが送る (#1131)
      if (useRepresentative().isRepresentative.value) {
        useStreamingStore().applyPersistedMode(useAccountsStore().accounts)
        // オフラインのまま起動すると更新確認は走らずに戻る。解除で確認する (#1350)。
        // 起動ごとに 1 回の確認なので、済んでいれば何も起きない
        if (isTauri) {
          commands.updateCheck(false).catch(() => undefined)
        }
      }
      // 再接続と catch-up は復帰信号に乗せる
      useUiStore().emitDeckResume()
    },
    { flush: 'sync' },
  )

  // 凍結アカウントの問い合わせを止める / 再開する (#1350)。起動時にオフラインの
  // 場合もあるので immediate。suspensions はこの store を読めない (輪になる) ので、
  // こちらから伝える
  watch(isOfflineMode, (now) => useSuspensionsStore().setPaused(now), {
    immediate: true,
  })

  async function enable(): Promise<void> {
    await setManual(true)
  }

  async function disable(): Promise<void> {
    if (!(await setManual(false))) return
    if (systemState.adaptation.goOffline) autoSuppressed.value = true
  }

  async function toggle(): Promise<void> {
    if (isOfflineMode.value) {
      await disable()
    } else {
      await enable()
    }
  }

  return {
    isOfflineMode,
    isManualOffline,
    isAutoOffline,
    load,
    enable,
    disable,
    toggle,
  }
})
