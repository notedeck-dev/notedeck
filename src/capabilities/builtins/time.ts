import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * `time.now` — ユーザー環境の現在時刻を ISO 8601 形式で返す。
 *
 * Phase 2 A-3.1 の動作確認用 sample capability。副作用なし、permissions 不要。
 * AI が「今何時?」と聞かれたとき、context block ではなく tool 経由で時刻を
 * 取得できることを実証する。
 */
export const timeNowCapability = implementCore('time.now')

/** Builtin capability すべて。起動時に register する用。 */
export const BUILTIN_CAPABILITIES: readonly Command[] = [timeNowCapability]
