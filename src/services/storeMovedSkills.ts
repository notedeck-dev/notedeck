import type { SkillItem } from '@/services/distributableCodecs/skillCodec'

/**
 * 同梱をやめて MisStore 配布に移した skill (#969 → #746)。
 *
 * #969 で自己拡張の作者系 4 本とリファレンス 2 本を移し、#746 で残る 3 本も
 * 移した。**同梱の skill はゼロになり、シード機構そのものが不要になった** —
 * 同梱のままだと修正版を届ける手段が削除・再シードしかないのに対し、配布に
 * 移せばストアの更新検知がそのまま使えるため。
 */
export const STORE_MOVED_SKILL_IDS = [
  'plugin-author',
  'widget-author',
  'theme-author',
  'skill-author',
  'aiscript-author',
  'theme-reference',
  'notedeck-guide',
  'notedeck-memo',
  'self-profile',
] as const

const MOVED = new Set<string>(STORE_MOVED_SKILL_IDS)

/**
 * 既に seed 済みのユーザーの手元に残っている旧 built-in を、MisStore 配布版
 * 相当 (`builtIn: false` + `store`) に変換する。aizu で実績のあるパターン。
 *
 * 削除ではなく変換なのは、ユーザーが本文を書き換えている可能性があるため。
 * 本文・mode・triggers はそのまま残し、以降はストアから更新できるようにする
 * だけに留める。store factory の `migrate` hook の契約どおり in-place で直し、
 * 変えた個体を返す
 */
export function migrateStoreMovedSkills(
  items: SkillItem[],
  now: number,
): SkillItem[] {
  const changed: SkillItem[] = []
  for (const s of items) {
    if (!s.extra.builtIn || !MOVED.has(s.id)) continue
    s.extra = { ...s.extra, builtIn: false }
    s.store = { id: s.id }
    s.updatedAt = now
    changed.push(s)
  }
  return changed
}

/**
 * 旧 built-in aizu (mode='always', builtIn=true, ローカル iconUrl) を MisStore
 * 配布版相当 (mode='manual', builtIn=false, store 'aizu', remote iconUrl) に
 * 変換し、ユーザーが任意に有効 / 無効化できるようにする。in-place で直し、
 * 変えた個体を返す
 */
export function migrateLegacyAizu(
  items: SkillItem[],
  now: number,
): SkillItem[] {
  const aizu = items.find((s) => s.id === 'aizu' && s.extra.builtIn)
  if (!aizu) return []
  aizu.extra = { ...aizu.extra, mode: 'manual', builtIn: false }
  aizu.store = { id: 'aizu' }
  aizu.iconUrl = 'https://store.notedeck.io/registry/skills/aizu/icon.svg'
  aizu.updatedAt = now
  return [aizu]
}
