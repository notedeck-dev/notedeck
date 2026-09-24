import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/** `notes.search` — Misskey の /notes/search 経由でキーワード検索 */
export const notesSearchCapability = implementCore('notes.search')

/**
 * `notes.searchArchive` — 手元の索引 (キャッシュ) をサーバー・アカウント横断で
 * 引く (#947)。サーバー検索 (`notes.search`) では答えられない「いつか見たノート」に
 * 届く。索引にはフォロワー限定 / ダイレクトも入っているので、権限は
 * `notes.readArchive` (既定は閉じる) に分け、公開範囲も既定で public だけ。
 * ローカル DB の読取なので adapter を通さず Tauri command を直接呼ぶ
 * (Misskey API ではないためフォーク差異の対象外)。
 */
export const notesSearchArchiveCapability = implementCore('notes.searchArchive')

/** `notes.timeline` — home / local / social / global タイムライン取得 */
export const notesTimelineCapability = implementCore('notes.timeline')

/** `notes.user` — 特定ユーザーの最近のノート取得 */
export const notesUserCapability = implementCore('notes.user')

/** `notes.show` — 単一ノートを ID で取得 */
export const notesShowCapability = implementCore('notes.show')

/** `notes.children` — 指定ノートへのリプライ (子ノート) を取得 */
export const notesChildrenCapability = implementCore('notes.children')

export const NOTES_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesSearchCapability,
  notesSearchArchiveCapability,
  notesTimelineCapability,
  notesUserCapability,
  notesShowCapability,
  notesChildrenCapability,
]
