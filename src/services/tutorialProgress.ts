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
}

export function emptyProgress(): TutorialProgress {
  return { version: 1, items: {}, achievements: {} }
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
  return {
    version: 1,
    items: sanitizeUnlocks(obj.items),
    achievements: sanitizeUnlocks(obj.achievements),
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
  return {
    version: 1,
    items: mergeUnlocks(a.items, b.items),
    achievements: mergeUnlocks(a.achievements, b.achievements),
  }
}
