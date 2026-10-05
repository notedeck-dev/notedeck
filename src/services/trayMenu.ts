import type { TrayMenuState } from '@/bindings'

/** トレイのメニュー表示を決める材料 (#1174)。文言は呼び出し側が表示言語で渡す */
export interface TrayMenuInput {
  labels: {
    show: string
    offline: string
    realtime: string
    heartbeat: string
    resident: string
    quit: string
  }
  offline: boolean
  realtime: boolean
  heartbeatEnabled: boolean
  /** 「アプリを終了しても AI を動かす」が今 ON か (ログイン時タスクの登録済み) */
  residentInstalled: boolean
  /** AI 系を別プロセスの notemaid に中継しているか */
  relayed: boolean
  /** この OS で常駐できるか */
  residentAvailable: boolean
}

/**
 * トレイに押し込む状態を組む。常駐の切り替えは AI 設定の行と同じ条件
 * (HEARTBEAT 有効 + 別プロセス + この OS で可能) のときだけ押せる
 */
export function trayMenuState(input: TrayMenuInput): TrayMenuState {
  return {
    showLabel: input.labels.show,
    offlineLabel: input.labels.offline,
    offline: input.offline,
    realtimeLabel: input.labels.realtime,
    realtime: input.realtime,
    heartbeatLabel: input.labels.heartbeat,
    heartbeat: input.heartbeatEnabled,
    residentLabel: input.labels.resident,
    resident: input.residentInstalled,
    residentEnabled:
      input.heartbeatEnabled && input.relayed && input.residentAvailable,
    quitLabel: input.labels.quit,
  }
}
