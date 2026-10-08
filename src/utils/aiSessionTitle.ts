/**
 * AI セッションの自動タイトル (services/sessionTitle) に i18n の既定接尾辞
 * (「のチャット」) を足す薄い包み。
 */

import { i18n } from '@/i18n'
import {
  generateSessionTitle as generateSessionTitleCore,
  timestampTitle as timestampTitleCore,
} from '@/services/sessionTitle'

/** `<YYYY-MM-DD HH:mm> <suffix>`。suffix の既定は「のチャット」 */
export function timestampTitle(
  now: Date,
  suffix: string = i18n.ts._aiSessionTitle.chatSuffix,
): string {
  return timestampTitleCore(now, suffix)
}

/** 整形後 4 文字未満なら `timestampTitle(now)` にフォールバックする */
export function generateSessionTitle(
  firstUserMessage: string,
  now: Date = new Date(),
): string {
  return generateSessionTitleCore(
    firstUserMessage,
    i18n.ts._aiSessionTitle.chatSuffix,
    now,
  )
}
