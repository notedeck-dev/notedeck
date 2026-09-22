/**
 * themes/ に置かれた素の `.json5` (コミュニティテーマ) の drop-in 取り込み (#1041)。
 *
 * 純ロジックのみ。ファイル I/O と採用の実行は stores/themeFileSync が担う。
 *
 * 設計判断 (#913 の検証で確定):
 * - 対象は「素の `.json5` で、既知の複合拡張子に一致しないもの」
 * - テーマとして解釈できた場合だけ、正規の slug 名ファイルとして**コピーして
 *   採用**する。元ファイルはリネーム・削除しない (外部エディタで編集中の
 *   ファイルを壊さない)
 * - 採用判定は slug の占有ではなく**採用記録** (元ファイル名 → 採用済み ID)
 *   で行う。slug 判定だと採用後のアプリ内リネームで slug が空き、起動のたびに
 *   再採用されて複製が出る
 * - 採用コピーには新しい ID を付与する (元ファイル内の ID は使わない。既存
 *   テーマとの ID 衝突と「同 ID = 更新」の誤爆を根絶するため)
 * - 採用後に元ファイルを編集しても反映されない (採用は一回きりのコピー)
 */

import JSON5 from 'json5'
import type { MisskeyTheme } from '@/theme/types'
import { casefold } from './settingsSlug'

/** 素の `.json5` から除外する既知の複合拡張子 */
const KNOWN_COMPOUND_EXTS = [
  '.ndtheme.json5',
  '.ndprofile.json5',
  '.history.json5',
  '.meta.json5',
]

/** 採用記録: 元ファイル名 (casefold) → 採用したテーマ ID */
export type DropInRecord = Record<string, string>

/** テーマ本体 (ID は採用側が付ける) */
export type DropInThemeBody = Omit<MisskeyTheme, 'id' | 'fileBase'>

export function isDropInCandidate(filename: string): boolean {
  if (!filename.endsWith('.json5') || filename === '.json5') return false
  return !KNOWN_COMPOUND_EXTS.some((ext) => filename.endsWith(ext))
}

/** 記録に無い候補だけを列挙順で返す */
export function pickPendingDropIns(
  files: readonly string[],
  record: DropInRecord,
): string[] {
  return files.filter((f) => isDropInCandidate(f) && !(casefold(f) in record))
}

/** 元ファイルが消えた記録を落とす。同じ名前で再 drop されたら採用し直す */
export function pruneDropInRecord(
  record: DropInRecord,
  files: readonly string[],
): DropInRecord {
  const present = new Set(files.map(casefold))
  return Object.fromEntries(
    Object.entries(record).filter(([k]) => present.has(k)),
  )
}

/**
 * テーマとして解釈できれば本体を返す。判定は既存のローダーと同じ
 * 「props を持つオブジェクト」。Misskey コミュニティテーマの author / desc は
 * 既存の投影と同じく落ちる。元ファイルの $notedeck は引き継がない
 * (外部由来のファイルにストア紐付き / per-account 紐付きを持ち込まない)
 */
export function parseDropInTheme(
  raw: string,
  filename: string,
): DropInThemeBody | null {
  let p: unknown
  try {
    p = JSON5.parse(raw)
  } catch {
    return null
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const obj = p as Record<string, unknown>
  const props = obj.props
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null
  const stem = filename.slice(0, -'.json5'.length)
  return {
    name: typeof obj.name === 'string' && obj.name ? obj.name : stem,
    base: obj.base === 'light' ? 'light' : 'dark',
    props: props as Record<string, string>,
  }
}

/** 新規作成と同じ `custom-<time>` 形式で、既存 ID と衝突しない ID を返す */
export function nextDropInId(
  takenIds: ReadonlySet<string>,
  now: number = Date.now(),
): string {
  const base = `custom-${now}`
  if (!takenIds.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!takenIds.has(candidate)) return candidate
  }
}

export function parseDropInRecord(raw: string): DropInRecord {
  if (!raw.trim()) return {}
  try {
    const p = JSON5.parse(raw) as { adopted?: unknown }
    const adopted = p?.adopted
    if (!adopted || typeof adopted !== 'object' || Array.isArray(adopted)) {
      return {}
    }
    const out: DropInRecord = {}
    for (const [k, v] of Object.entries(adopted)) {
      if (typeof v !== 'string') return {}
      out[casefold(k)] = v
    }
    return out
  } catch {
    return {}
  }
}

export function serializeDropInRecord(record: DropInRecord): string {
  return `${[
    '// themes/ に置かれた素の .json5 から取り込んだ記録 (#1041)。',
    '// 元ファイル名 → 採用したテーマ ID。ここに載っている元ファイルは再取り込みしない。',
    '// 取り込み直したいときは該当行を消す (アプリ内で消したテーマも同様)。',
    JSON5.stringify({ adopted: record }, null, 2),
  ].join('\n')}\n`
}
