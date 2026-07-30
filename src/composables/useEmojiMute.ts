import { computed } from 'vue'
import { useConfirm } from '@/stores/confirm'
import { useSettingsStore } from '@/stores/settings'
import { normalizeEmojiMuteKey } from '@/utils/emojiMute'

/**
 * 絵文字ミュート (#612)。settings.json の `mute.emojis` が単一 source of truth。
 * ミュートは「非表示」ではなく描画側でのプレースホルダー置換に使う
 * (#610 soft ワードミュートと同じ「データ保持 + 表示時判定」の系譜)。
 */
export function useEmojiMute() {
  const settings = useSettingsStore()

  const mutedEmojis = computed(() => settings.get('mute.emojis') ?? [])
  const mutedSet = computed(() => new Set(mutedEmojis.value))

  /** キー形式の揺れ (`:name@.:` / bare shortcode / Unicode) を正規化して判定 */
  function isEmojiMuted(emoji: string): boolean {
    if (mutedSet.value.size === 0) return false
    return mutedSet.value.has(normalizeEmojiMuteKey(emoji))
  }

  function muteEmoji(emoji: string): void {
    const key = normalizeEmojiMuteKey(emoji)
    if (mutedSet.value.has(key)) return
    settings.set('mute.emojis', [...mutedEmojis.value, key])
  }

  function unmuteEmoji(emoji: string): void {
    const key = normalizeEmojiMuteKey(emoji)
    if (!mutedSet.value.has(key)) return
    settings.set(
      'mute.emojis',
      mutedEmojis.value.filter((k) => k !== key),
    )
  }

  /**
   * 確認ダイアログ付きでミュート状態をトグルする (本家準拠)。
   * メニュー項目から共通で使う。キャンセル時は何もしない。
   */
  async function toggleEmojiMuteWithConfirm(emoji: string): Promise<void> {
    const { confirm } = useConfirm()
    const key = normalizeEmojiMuteKey(emoji)
    if (isEmojiMuted(emoji)) {
      const ok = await confirm({
        title: '絵文字ミュートを解除',
        message: `${key} のミュートを解除しますか？`,
      })
      if (ok) unmuteEmoji(emoji)
    } else {
      const ok = await confirm({
        title: '絵文字をミュート',
        message: `${key} をミュートしますか？本文とリアクションでプレースホルダー表示になります。`,
      })
      if (ok) muteEmoji(emoji)
    }
  }

  return {
    mutedEmojis,
    isEmojiMuted,
    muteEmoji,
    unmuteEmoji,
    toggleEmojiMuteWithConfirm,
  }
}
