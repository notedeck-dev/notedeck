// Unicode 絵文字のキーワード辞書。データは本家 Misskey の
// packages/frontend/src/unicode-emoji-indexes をそのまま持つ (#1193)。
// 本家は設定から追加ダウンロードする形だが、NoteDeck は表示言語の辞書を
// 初めて検索したときに読む (辞書は大きいので起動時のバンドルに入れない)
import type { LanguageCode } from '@/i18n'
import type { UnicodeEmojiIndex } from '@/services/emojiSearch'

type Loader = () => Promise<{ default: UnicodeEmojiIndex }>

const loaders = {
  'en-US': () => import('./unicode-emoji-indexes/en-US.json'),
  'ja-JP': () => import('./unicode-emoji-indexes/ja-JP.json'),
  // ひらがな読み。IME で変換せずに打っても引けるよう日本語と一緒に読む
  'ja-JP_hira': () => import('./unicode-emoji-indexes/ja-JP_hira.json'),
} satisfies Record<string, Loader>

const cache = new Map<LanguageCode, Promise<UnicodeEmojiIndex[]>>()

export function loadUnicodeEmojiIndexes(
  lang: LanguageCode,
): Promise<UnicodeEmojiIndex[]> {
  let pending = cache.get(lang)
  if (!pending) {
    const names: (keyof typeof loaders)[] =
      lang === 'ja-JP' ? ['ja-JP', 'ja-JP_hira'] : ['en-US']
    pending = Promise.all(names.map((n) => loaders[n]().then((m) => m.default)))
    // 失敗は次の検索で読み直せるよう覚えない
    pending.catch(() => cache.delete(lang))
    cache.set(lang, pending)
  }
  return pending
}
