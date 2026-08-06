import type { NormalizedNote, NoteVisibility } from '@/adapters/types'
import { noteModeBadgeIcon } from '@/utils/customTimelines'
import { extractUrlFromMfm } from '@/utils/extractUrlFromMfm'
import { parseMfm } from '@/utils/mfm'

/**
 * MkNote のビューモデル導出ロジック (#707)。表示派生値の計算を
 * コンポーネントから抽出した純関数群。
 */

/** renote のみで本文が無い「純粋リノート」か。 */
export function isPureRenote(note: NormalizedNote): boolean {
  return !!note.renote && note.text === null
}

/** 純粋リノートなら内側のノート、それ以外は自身を表示対象にする。 */
export function resolveEffectiveNoteBase(note: NormalizedNote): NormalizedNote {
  return note.renote && note.text === null ? note.renote : note
}

/** 本文から抽出した URL（renote の url/uri と一致するものは除外）。 */
export function extractNoteUrls(note: NormalizedNote): string[] {
  const text = note.text
  if (!text) return []
  const tokens = parseMfm(text)
  const renote = note.renote
  return extractUrlFromMfm(tokens).filter(
    (u) => u !== renote?.url && u !== renote?.uri,
  )
}

/** チャンネル id から決定論的な表示色を導出する (color 未設定チャンネル用)。 */
export function hashChannelColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const hue = ((h % 360) + 360) % 360
  return `hsl(${hue}, 65%, 55%)`
}

export interface NoteChannelInfo {
  id: string
  name: string | null
  color: string
}

/** チャンネルバッジ表示情報。channel 未 hydrate (channelId のみ) にも対応。 */
export function deriveChannelInfo(
  note: NormalizedNote,
): NoteChannelInfo | null {
  const ch = note.channel
  const id = ch?.id ?? note.channelId
  if (!id) return null
  return {
    id,
    name: ch?.name ?? null,
    color: ch?.color || hashChannelColor(id),
  }
}

export const LONG_TEXT_THRESHOLD = 500
export const LONG_TEXT_LINES = 8

/**
 * 長文折りたたみの対象か。CW 付きは CW の折りたたみ機構が優先されるので
 * 対象外。
 */
export function isLongNoteText(note: NormalizedNote): boolean {
  const text = note.text
  if (!text || note.cw !== null) return false
  if (text.length > LONG_TEXT_THRESHOLD) return true
  return text.split('\n').length > LONG_TEXT_LINES
}

/**
 * リノート可否（Misskey WebUI と同じ判定）。
 * public/home は誰でも可、followers は自分のノートのみ、specified は不可。
 */
export function canRenoteNote(
  note: NormalizedNote,
  isOwnNote: boolean,
): boolean {
  const v: NoteVisibility = note.visibility
  return v === 'public' || v === 'home' || (v === 'followers' && isOwnNote)
}

export interface ActiveModeFlag {
  key: string
  label: string
  /** Tabler アイコン名 (`ti-` プレフィックスなし) */
  icon: string
}

/** フォーク固有 modeFlags (`isNoteIn<X>Mode`) のうち有効なものをバッジ化する。 */
export function deriveActiveModeFlags(
  modeFlags: Record<string, boolean> | undefined,
): ActiveModeFlag[] {
  if (!modeFlags) return []
  return Object.entries(modeFlags)
    .filter(([, v]) => v)
    .map(([key]) => {
      const match = key.match(/^isNoteIn(.+)Mode$/)
      const label = match?.[1] ?? key
      return { key, label, icon: noteModeBadgeIcon(key) }
    })
}

export interface ReactionsData {
  sorted: { reaction: string; count: number }[]
  urls: Record<string, string | null>
}

/**
 * リアクション一覧の表示データ。キー昇順に整列し、カスタム絵文字 URL を
 * 注入された resolver (useEmojiResolver.reactionUrl) で解決する。
 */
export function buildReactionsData(
  note: NormalizedNote,
  reactionUrl: (
    reaction: string,
    emojis: Record<string, string>,
    reactionEmojis: Record<string, string>,
    serverHost: string,
  ) => string | null,
): ReactionsData {
  const reactions = note.reactions
  const keys = Object.keys(reactions)
  if (keys.length === 0) {
    return { sorted: [], urls: {} }
  }
  keys.sort()
  const sorted: { reaction: string; count: number }[] = new Array(keys.length)
  const urls: Record<string, string | null> = {}
  for (let i = 0; i < keys.length; i++) {
    const reaction = keys[i] as string
    sorted[i] = { reaction, count: reactions[reaction] as number }
    urls[reaction] = reactionUrl(
      reaction,
      note.emojis,
      note.reactionEmojis,
      note._serverHost,
    )
  }
  return { sorted, urls }
}

/**
 * アンカー要素直下にポップアップメニューを出すときの位置決め。
 * 右端は 8px 余白で clamp、下端からはみ出す場合はアンカー上側へ反転、
 * 左上は最低 8px を確保する。
 */
export function clampMenuPosition(
  anchor: { left: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  let x = anchor.left
  let y = anchor.bottom + 4
  if (x + menu.width > viewport.width) x = viewport.width - menu.width - 8
  if (y + menu.height > viewport.height) {
    y = Math.max(8, anchor.top - menu.height - 4)
  }
  x = Math.max(8, x)
  y = Math.max(8, y)
  return { x, y }
}
