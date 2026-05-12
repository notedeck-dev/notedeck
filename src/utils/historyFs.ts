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
}

interface HistoryFile<T = unknown> {
  entries: HistoryEntry<T>[]
}

const RING_SIZE = 10

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
 * snapshot を history に push する。リングを `RING_SIZE` で維持。
 * 失敗は warn だけ吐いて呼出し元を止めない (= 編集本体を阻害しない)。
 */
export async function pushSnapshot<T>(
  kind: HistoryKind,
  basename: string,
  snapshot: T,
): Promise<void> {
  try {
    const file = await readFile<T>(kind, basename)
    file.entries.unshift({ at: Date.now(), snapshot })
    if (file.entries.length > RING_SIZE) {
      file.entries = file.entries.slice(0, RING_SIZE)
    }
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
