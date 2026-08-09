/**
 * tutorial.json5 の codec (#1029)。
 *
 * チュートリアルの達成記録を保持する。プロファイル・アカウントからは独立して
 * いる (アプリ操作の習熟はアカウントに紐づかない)。
 *
 * 記録が要る理由: 完了検知はシステム状態からの導出が基本だが、「Stream
 * Inspector を開いた」のようにカラムを閉じると false に戻るものがある。
 * 一度達成したら戻らない latch としてここに残す。
 */

import JSON5 from 'json5'

/** step id / カテゴリ id → 達成時刻 (epoch ms) */
type Unlocks = Record<string, number>

export interface TutorialProgress {
  version: 1
  /** step 単位の達成記録 */
  items: Unlocks
  /** カテゴリ完走で解除される実績 */
  achievements: Unlocks
  /**
   * 状態からの自動記録を再開する時刻 (epoch ms)。
   *
   * 達成の多くは「ログイン済み」「カラムがある」のように状態が続くので、
   * 記録を消しても次の評価で全部書き戻ってしまう (実績が復活し、通知が
   * 再送される)。消したことを覚えるためにこの時刻を置き、これ以降に
   * 明示的に走らせた分だけを拾う。
   */
  resetAt?: number
}

export function emptyProgress(): TutorialProgress {
  return { version: 1, items: {}, achievements: {} }
}

/**
 * 記録を消す。状態から導出できる項目が書き戻らないよう、消した時刻を残す。
 */
export function clearProgress(at: number): TutorialProgress {
  return { version: 1, items: {}, achievements: {}, resetAt: at }
}

/** 達成時刻の map として妥当なエントリだけを拾う */
function sanitizeUnlocks(value: unknown): Unlocks {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const out: Unlocks = {}
  for (const [key, at] of Object.entries(value)) {
    if (typeof at === 'number' && Number.isFinite(at)) out[key] = at
  }
  return out
}

/**
 * 保存内容を読む。壊れていても例外を投げず空の進捗に倒す
 * (達成記録が読めないだけでチュートリアルが開けなくなることは避ける)。
 */
export function parseTutorialProgress(content: string): TutorialProgress {
  let raw: unknown
  try {
    raw = JSON5.parse(content)
  } catch {
    return emptyProgress()
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return emptyProgress()
  }
  const obj = raw as Record<string, unknown>
  const resetAt = obj.resetAt
  return {
    version: 1,
    items: sanitizeUnlocks(obj.items),
    achievements: sanitizeUnlocks(obj.achievements),
    ...(typeof resetAt === 'number' && Number.isFinite(resetAt)
      ? { resetAt }
      : {}),
  }
}

export function serializeTutorialProgress(progress: TutorialProgress): string {
  return `${JSON5.stringify(progress, null, 2)}\n`
}

/** 達成時刻を記録する。記録済みなら最初の時刻を残す (冪等) */
function withUnlock(unlocks: Unlocks, key: string, at: number): Unlocks {
  if (unlocks[key] != null) return unlocks
  return { ...unlocks, [key]: at }
}

export function markItemDone(
  progress: TutorialProgress,
  stepId: string,
  at: number,
): TutorialProgress {
  return { ...progress, items: withUnlock(progress.items, stepId, at) }
}

export function unlockAchievement(
  progress: TutorialProgress,
  categoryId: string,
  at: number,
): TutorialProgress {
  return {
    ...progress,
    achievements: withUnlock(progress.achievements, categoryId, at),
  }
}

/** 消した時刻より前の記録を落とす (別ウィンドウの古い内容で復活させない) */
function dropBefore(unlocks: Unlocks, at: number | undefined): Unlocks {
  if (at == null) return unlocks
  const out: Unlocks = {}
  for (const [key, unlockedAt] of Object.entries(unlocks)) {
    if (unlockedAt >= at) out[key] = unlockedAt
  }
  return out
}

/** 衝突したキーは早い達成時刻を残す */
function mergeUnlocks(a: Unlocks, b: Unlocks): Unlocks {
  const out: Unlocks = { ...a }
  for (const [key, at] of Object.entries(b)) {
    const existing = out[key]
    out[key] = existing == null ? at : Math.min(existing, at)
  }
  return out
}

/**
 * 2 つの進捗を統合する。保存は read-merge-write で行い、別ウィンドウが
 * 書いた達成記録を上書きで消さないようにする。
 */
export function mergeProgress(
  a: TutorialProgress,
  b: TutorialProgress,
): TutorialProgress {
  // resetAt は新しい方を残す。片方が「消した」と言っているなら、その後の
  // 記録だけが有効
  const resetAt =
    a.resetAt == null || b.resetAt == null
      ? (a.resetAt ?? b.resetAt)
      : Math.max(a.resetAt, b.resetAt)
  // 落としてから統合する。先に統合すると、消す前の古い達成時刻が min として
  // 勝ってしまい、消した後にやり直した分まで巻き添えで落ちる
  return {
    version: 1,
    items: mergeUnlocks(
      dropBefore(a.items, resetAt),
      dropBefore(b.items, resetAt),
    ),
    achievements: mergeUnlocks(
      dropBefore(a.achievements, resetAt),
      dropBefore(b.achievements, resetAt),
    ),
    ...(resetAt == null ? {} : { resetAt }),
  }
}
