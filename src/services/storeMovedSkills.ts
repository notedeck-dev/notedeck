import type { SkillMeta } from '@/stores/skills'

/**
 * 同梱をやめて MisStore 配布に移した built-in skill (#969)。
 *
 * 自己拡張の作者系 4 本と、その依存先のリファレンス 2 本。同梱は
 * notedeck-memo / self-profile / notedeck-guide の 3 本だけになる。
 */
export const STORE_MOVED_SKILL_IDS = [
  'plugin-author',
  'widget-author',
  'theme-author',
  'skill-author',
  'aiscript-author',
  'theme-reference',
] as const

const MOVED = new Set<string>(STORE_MOVED_SKILL_IDS)

export interface StoreMovedMigrationPlan {
  migrated: SkillMeta[]
  /** 1 件でも変換したか (false なら永続化も不要) */
  changed: boolean
  /** 実際に変換した skill (呼び出し側はこれだけ persist すればよい) */
  changedSkills: SkillMeta[]
}

/**
 * 既に seed 済みのユーザーの手元に残っている旧 built-in を、MisStore 配布版
 * 相当 (`builtIn: false` + `storeId`) に変換する。aizu で実績のあるパターン。
 *
 * 削除ではなく変換なのは、ユーザーが本文を書き換えている可能性があるため。
 * 本文・mode・triggers はそのまま残し、以降はストアから更新できるようにする
 * だけに留める。
 */
export function planStoreMovedMigration(
  skills: readonly SkillMeta[],
  now: number,
): StoreMovedMigrationPlan {
  if (!skills.some((s) => s.builtIn === true && MOVED.has(s.id))) {
    return {
      migrated: skills as SkillMeta[],
      changed: false,
      changedSkills: [],
    }
  }
  const changedSkills: SkillMeta[] = []
  const migrated = skills.map((s) => {
    if (s.builtIn !== true || !MOVED.has(s.id)) return s
    const next: SkillMeta = {
      ...s,
      builtIn: false,
      storeId: s.id,
      updatedAt: now,
    }
    changedSkills.push(next)
    return next
  })
  return { migrated, changed: true, changedSkills }
}
