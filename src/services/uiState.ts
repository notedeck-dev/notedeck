/**
 * この機械の UI の状態 `state/ui.json5` (#1333 §3)。
 *
 * ペットの位置・webview のズーム・投稿フォームの前回値は、窓を動かす / 投稿する
 * たびに変わる値で、別の機械に持ち出しても意味を持たない。設定 (settings.json5) に
 * 混ぜると Git で管理したとき差分が汚れるので、状態として分ける。
 *
 * 「最後に書いた者勝ち・窓間同期あり・エディタ無し」の小さいファイル。settings.json5
 * のような版つき条件付き書込や dirtyKeys の衝突マージは付けない (どの値も次の操作で
 * 上書きされる)。
 */

import JSON5 from 'json5'
import { stringifyJson5 } from './json5Document'

export type UiStateVisibility =
  | 'public'
  | 'public_non_ltl'
  | 'home'
  | 'followers'
  | 'specified'
  | 'private'

export interface UiState {
  /**
   * webview の拡大率 (1 = 等倍)。Ctrl+± / メニューで変えた値を保存し、
   * 全ウィンドウに当てる。許容範囲は `services/uiZoom.ts` が正本で、
   * 範囲外の手編集は読み込み時に丸める
   */
  'ui.zoom'?: number
  /**
   * ペットの位置 (右端からの px / 下端からの px)。下端はコンパクト時は
   * モバイルナビの上端が基準。ドラッグで動かした値だけ保存する
   */
  'pet.right'?: number
  'pet.bottom'?: number
  /** rememberVisibility ON のとき、アカウントごとに最後に使った公開範囲 */
  'postForm.lastUsedVisibilityByAccount'?: Record<string, UiStateVisibility>
  'postForm.lastUsedLocalOnlyByAccount'?: Record<string, boolean>
  /**
   * サイドバーで開いたスクラッチパッド / MFM エディタの本文と、AI カラムで開いて
   * いたセッション。サイドバーのカラムは閉じると消えるので、ここに残して開き直す
   * ときに戻す (キーはカラムのプロパティ名)
   */
  'deck.sidebarDrafts'?: SidebarDrafts
}

export type SidebarDrafts = Partial<
  Record<'aiscriptCode' | 'mfmText' | 'aiCurrentSessionId', string>
>

export type UiStateKey = keyof UiState

/** settings.json5 から出したキー。`parseSettings` はこれを剥がす */
export const UI_STATE_KEYS: readonly UiStateKey[] = [
  'ui.zoom',
  'pet.right',
  'pet.bottom',
  'postForm.lastUsedVisibilityByAccount',
  'postForm.lastUsedLocalOnlyByAccount',
  'deck.sidebarDrafts',
] as const

export function isUiStateKey(key: string): key is UiStateKey {
  return (UI_STATE_KEYS as readonly string[]).includes(key)
}

/** 本文 → 状態。空 (無い) / 壊れているは空。既知のキーだけ拾う */
export function parseUiState(text: string): UiState {
  if (text.trim().length === 0) return {}
  let raw: unknown
  try {
    raw = JSON5.parse(text)
  } catch {
    return {}
  }
  return pickUiState(raw)
}

/** 任意のオブジェクトから UI の状態のキーだけを拾う (旧 settings.json5 の持ち越しにも使う) */
export function pickUiState(raw: unknown): UiState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of UI_STATE_KEYS) {
    const v = (raw as Record<string, unknown>)[key]
    if (v !== undefined && v !== null) out[key] = v
  }
  return out as UiState
}

/** 状態 → 本文 (決定的、キーは固定順) */
export function serializeUiState(state: UiState): string {
  const ordered: Record<string, unknown> = {}
  for (const key of UI_STATE_KEYS) {
    const v = state[key]
    if (v !== undefined) ordered[key] = v
  }
  return stringifyJson5(ordered)
}
