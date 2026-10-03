import type { NormalizedNote } from '@/adapters/types'
import {
  createWorkerClient,
  WorkerAbortedError,
  WorkerTimeoutError,
} from '@/utils/workerClient'
import type { RegexSearchResponse } from '@/workers/regexSearchWorker'

/**
 * 正規表現パターンからリテラル部分を抽出し、FTS5/サーバー検索のヒントにする。
 * 例: "(cat|dog).*food" → "food"（最長リテラル部分）
 */
export function extractLiterals(pattern: string): string {
  // 正規表現メタ文字でスプリットしてリテラル部分を取得
  const parts = pattern
    .split(/[\\^$.*+?()[\]{}|]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  if (parts.length === 0) return ''
  // 最長のリテラル部分を返す（ソート不要、単一パスで十分）
  return parts.reduce((max, s) => (s.length > max.length ? s : max), '')
}

/**
 * 安全に RegExp を生成する。無効なパターンの場合は null を返す。
 */
export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

/**
 * 正規表現パターンが有効かどうかを判定する。
 */
export function isValidRegex(pattern: string): boolean {
  return safeRegex(pattern) !== null
}

/**
 * ノートのテキスト（text + CW + ユーザー名）に正規表現がマッチするか判定。
 */
function noteMatchesRegex(note: NormalizedNote, regex: RegExp): boolean {
  if (note.text && regex.test(note.text)) return true
  if (note.cw && regex.test(note.cw)) return true
  if (note.user.name && regex.test(note.user.name)) return true
  if (regex.test(note.user.username)) return true
  // Renote の中身もチェック
  if (note.renote) {
    if (note.renote.text && regex.test(note.renote.text)) return true
    if (note.renote.cw && regex.test(note.renote.cw)) return true
  }
  return false
}

/**
 * ノート配列を正規表現でフィルタリング。
 */
export function filterNotesByRegex(
  notes: NormalizedNote[],
  pattern: string,
): NormalizedNote[] {
  const regex = safeRegex(pattern)
  if (!regex) return notes
  return notes.filter((note) => noteMatchesRegex(note, regex))
}

/** 1 バッチの照合に許す時間。超えたら Worker ごと止める (カラムクエリの逐次適用と同じ発想) */
const REGEX_FILTER_TIMEOUT_MS = 3000

const regexWorker = createWorkerClient<RegexSearchResponse>(
  () =>
    new Worker(new URL('../workers/regexSearchWorker.ts', import.meta.url), {
      type: 'module',
    }),
  { timeoutMs: REGEX_FILTER_TIMEOUT_MS },
)

export type RegexFilterFailure =
  | 'invalid'
  | 'timeout'
  | 'aborted'
  | 'unavailable'

/**
 * 正規表現の照合の失敗。呼び出し側は検索を「照合の失敗」として示し、
 * 素通し (無条件の結果) にはしない
 */
export class RegexFilterError extends Error {
  readonly kind: RegexFilterFailure

  constructor(kind: RegexFilterFailure) {
    super(`Regex filter failed: ${kind}`)
    this.name = 'RegexFilterError'
    this.kind = kind
  }
}

/**
 * 正規表現フィルタリングを別スレッドで実行する。メインスレッドをブロックせず、
 * 破滅的なパターンは時間上限で止める。主スレッドには落とさない (壊れた
 * パターンを持ち込んだ検索だけが失敗し、UI は固まらない)。無効なパターンも
 * 素通しせず失敗にする
 */
export function filterNotesByRegexAsync(
  notes: NormalizedNote[],
  pattern: string,
): Promise<NormalizedNote[]> {
  if (!safeRegex(pattern)) {
    return Promise.reject(new RegexFilterError('invalid'))
  }
  return regexWorker
    .post({ type: 'filter', notes, pattern })
    .then((res) => res.notes)
    .catch((e: unknown) => {
      if (e instanceof WorkerTimeoutError) throw new RegexFilterError('timeout')
      if (e instanceof WorkerAbortedError) throw new RegexFilterError('aborted')
      throw new RegexFilterError('unavailable')
    })
}
