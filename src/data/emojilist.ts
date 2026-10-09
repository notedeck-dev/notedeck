// Unicode 絵文字の一覧。データは本家 Misskey の
// packages/frontend-shared/js/emojilist.json をそのまま持つ ([文字, 英名, カテゴリ番号])。
// 本家と同じ英名で検索できるよう、文字だけの独自リストから置き換えた (#1193)
import rawList from './emojilist.json'

export const unicodeEmojiCategories = [
  'face',
  'people',
  'animals_and_nature',
  'food_and_drink',
  'activity',
  'travel_and_places',
  'objects',
  'symbols',
  'flags',
] as const

export type UnicodeEmojiCategory = (typeof unicodeEmojiCategories)[number]

export interface UnicodeEmojiDef {
  char: string
  name: string
  category: UnicodeEmojiCategory
}

export const emojilist: UnicodeEmojiDef[] = (
  rawList as [string, string, number][]
).map(([char, name, category]) => ({
  char,
  name,
  category: unicodeEmojiCategories[category] ?? 'symbols',
}))

export const emojiCharByCategory = new Map<UnicodeEmojiCategory, string[]>(
  unicodeEmojiCategories.map((c) => [c, []]),
)
for (const e of emojilist) emojiCharByCategory.get(e.category)?.push(e.char)
