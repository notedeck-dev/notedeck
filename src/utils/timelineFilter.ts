import type {
  NormalizedNote,
  TimelineFilter,
  TimelineType,
} from '@/adapters/types'

/** Local / Global TL では public 以外のノートを除外する */
function matchesVisibility(
  note: NormalizedNote,
  timelineType?: TimelineType,
): boolean {
  if (!timelineType) return true
  if (timelineType === 'local' || timelineType === 'global') {
    return note.visibility === 'public'
  }
  return true
}

/**
 * ストリーミングで受信したノートがフィルター条件にマッチするか判定する。
 * REST API 側のフィルターを補完するクライアント側フィルタリング用。
 */
export function matchesFilter(
  note: NormalizedNote,
  filter?: TimelineFilter,
  timelineType?: TimelineType,
): boolean {
  // visibility チェック（TL種別に基づく防御層）
  if (!matchesVisibility(note, timelineType)) return false

  if (!filter) return true

  // Renote のみ（引用なし）を除外
  if (filter.withRenotes === false && note.renote && !note.text) return false

  // リプライを除外
  if (filter.withReplies === false && note.reply) return false

  // ファイル付きのみ表示
  if (filter.withFiles === true) {
    const hasFiles =
      note.files.length > 0 || (note.renote?.files?.length ?? 0) > 0
    if (!hasFiles) return false
  }

  // Bot を除外
  if (filter.withBots === false && note.user.isBot) return false

  // センシティブなファイルを含むノートを除外 (本家 withSensitive と同義)。
  // リノート先も見るのは withFiles と同じ理由 (TL にはその添付が出る)
  if (filter.withSensitive === false) {
    const hasSensitive =
      note.files.some((f) => f.isSensitive) ||
      (note.renote?.files?.some((f) => f.isSensitive) ?? false)
    if (hasSensitive) return false
  }

  return true
}
