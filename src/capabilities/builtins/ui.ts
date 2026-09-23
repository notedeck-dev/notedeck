import type { Command } from '@/commands/registry'
import { sendDesktopNotification } from '@/utils/desktopNotification'
import { implement } from '../declare'

/**
 * `ui.notify` — OS のデスクトップ通知を送る。AI が HEARTBEAT で重要な発見を
 * ユーザーに知らせたり、AiScript プラグインが「note:new に反応してデスクトップ
 * 通知」のような IFTTT 系自動化に使う。
 *
 * アプリがフォアグラウンドの時は表示されない (既存 sendDesktopNotification の
 * 挙動を踏襲。フォアグラウンド時はカラム内ノート表示で十分なため)。
 */
export const uiNotifyCapability = implement('ui.notify', {
  execute: (params) => {
    const title = typeof params?.title === 'string' ? params.title : ''
    if (!title) throw new Error('title is required')
    const body = typeof params?.body === 'string' ? params.body : ''
    sendDesktopNotification(title, body)
  },
})

export const UI_BUILTIN_CAPABILITIES: readonly Command[] = [uiNotifyCapability]
