/**
 * Edit history sidecar — skill / widget / plugin / theme の編集前 snapshot を
 * `<basename>.history.json5` にリング 10 件で保存する共通機構。
 *
 * `settingsFs.readHistorySidecar` / `writeHistorySidecar` を経由するので、
 * Tauri 環境のみ動作 (= ブラウザ環境では no-op に近く、push しても保存されない
 * が読取は空配列を返す)。
 *
 * 用途:
 * - 各 store の編集 mutator (skills.update / widgets.updateSrc 等) が前回値を
 *   `pushSnapshot()` してから書込
 * - `*.history` capability が `listSnapshots()` で履歴を返す
 * - `*.revert` capability が `getSnapshotAt()` で過去 body を取り出して
 *   store の通常 update を呼ぶ
 */

import JSON5 from 'json5'
import type { Principal } from '@/permissions/principal'
import { evictHistory, shouldCoalesceEdit } from '@/services/editHistory'
import {
  type HistoryKind,
  readHistorySidecar,
  writeHistorySidecar,
} from './settingsFs'

export type { HistoryKind } from './settingsFs'

/** 1 エントリ。`snapshot` は kind ごとに異なる構造の plain object。 */
export interface HistoryEntry<T = unknown> {
  /** Unix ms */
  at: number
  /** kind 固有の編集前 state */
  snapshot: T
  /**
   * 誰の編集か (#1052)。記録を始める前のエントリには無い (前方互換)。
   * 権限の principal をそのまま入れるので、確認ダイアログ・Spotlight・履歴で
   * 帰属の粒度が揃う。
   */
  by?: Principal
  /**
   * なぜ変えたか (#1052)。承認ダイアログで見せた理由を承認後に記録する。
   * 本人の手編集はデバウンスの自動保存で理由を書く機会が無いため付かない。
   */
  reason?: string
}

/** 編集の帰属と理由。書込側 (store の mutator) が capability から受け取る。 */
export interface EditAttribution {
  by?: Principal
  reason?: string
}

interface HistoryFile<T = unknown> {
  entries: HistoryEntry<T>[]
}

/**
 * 保持件数 (#1052)。帰属・理由を記録しても押し出されれば意味が無いので、
 * 単純な古い順のリングをやめて優先度付きの eviction にしたうえで枠を広げた。
 */
const RING_SIZE = 30

async function readFile<T>(
  kind: HistoryKind,
  basename: string,
): Promise<HistoryFile<T>> {
  const raw = await readHistorySidecar(kind, basename)
  if (!raw) return { entries: [] }
  try {
    const parsed = JSON5.parse(raw) as HistoryFile<T>
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch (e) {
    console.warn(`[history] failed to parse ${kind}/${basename}:`, e)
    return { entries: [] }
  }
}

async function writeFile<T>(
  kind: HistoryKind,
  basename: string,
  file: HistoryFile<T>,
): Promise<void> {
  const content = `${JSON5.stringify(file, null, 2)}\n`
  await writeHistorySidecar(kind, basename, content)
}

/**
 * snapshot を history に push する。件数は `RING_SIZE` を上限に、優先度の低い
 * ものから落とす (#1052)。本人の連続した自動保存は直前のエントリに畳んで
 * 積まない (古い方が「その編集セッションの直前の状態」として正しいため)。
 *
 * 失敗は warn だけ吐いて呼出し元を止めない (= 編集本体を阻害しない)。
 */
export async function pushSnapshot<T>(
  kind: HistoryKind,
  basename: string,
  snapshot: T,
  attribution?: EditAttribution,
): Promise<void> {
  try {
    const file = await readFile<T>(kind, basename)
    const at = Date.now()
    if (shouldCoalesceEdit(file.entries[0], { at, by: attribution?.by })) return
    file.entries.unshift({
      at,
      snapshot,
      ...(attribution?.by ? { by: attribution.by } : {}),
      ...(attribution?.reason ? { reason: attribution.reason } : {}),
    })
    file.entries = evictHistory(file.entries, RING_SIZE)
    await writeFile(kind, basename, file)
  } catch (e) {
    console.warn(`[history] push failed (${kind}/${basename}):`, e)
  }
}

/** history 一覧を新しい順に返す。 */
export async function listSnapshots<T>(
  kind: HistoryKind,
  basename: string,
): Promise<HistoryEntry<T>[]> {
  const file = await readFile<T>(kind, basename)
  return file.entries
}

/** index 番目の snapshot を取り出す。範囲外なら null。 */
export async function getSnapshotAt<T>(
  kind: HistoryKind,
  basename: string,
  index: number,
): Promise<HistoryEntry<T> | null> {
  const entries = await listSnapshots<T>(kind, basename)
  if (index < 0 || index >= entries.length) return null
  return entries[index] ?? null
}
