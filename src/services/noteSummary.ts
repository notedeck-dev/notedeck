/**
 * ノートを 1 つの文字列で表す (本家 getNoteSummary 相当, #1210)。
 *
 * 通知カラムでリアクション・リノート・投票終了の対象ノートを、埋め込まずに
 * 引用の 1 行で見せるために使う。CW があれば本文ではなく CW を出す
 * (通知の 1 行で CW の中身を開いてしまわないように)。
 */
import type { NormalizedNote } from '@/adapters/types'
import { i18n } from '@/i18n'

type SummaryNote = Pick<NormalizedNote, 'text' | 'cw' | 'files' | 'poll'> & {
  contentHidden?: boolean
  replyId?: string | null
  renoteId?: string | null
  reply?: SummaryNote
  renote?: SummaryNote
}

export function getNoteSummary(note: SummaryNote | null | undefined): string {
  if (note == null) return ''
  if (note.contentHidden) return `(${i18n.ts._noteSummary.hidden})`

  let summary = note.cw ?? note.text ?? ''
  if (note.files?.length) {
    summary += ` (${i18n.tsx._noteSummary.files_plural({ count: note.files.length })})`
  }
  if (note.poll) summary += ` (${i18n.ts._noteSummary.poll})`
  if (note.replyId) {
    summary += `\n\nRE: ${note.reply ? getNoteSummary(note.reply) : '...'}`
  }
  if (note.renoteId) {
    summary += `\n\nRN: ${note.renote ? getNoteSummary(note.renote) : '...'}`
  }
  return summary.trim()
}
