/**
 * MisStore widget の `capabilities` 配列と、NoteDeck カラム文脈 (accountId 等)
 * との互換性を判定する。
 *
 * 方針:
 * - 既知 capability は KNOWN_CAPABILITIES に列挙し、各々の要求条件を記述。
 * - 未知 capability は NoteDeck 未対応として非互換扱いにする (将来 MisStore が
 *   新しい capability を導入したとき、NoteDeck 未更新のユーザーが install して
 *   runtime エラーに遭遇するのを防ぐ)。
 */

export interface CapabilityContext {
  /** Widget カラムの accountId (未設定なら null = cross-account / ゲスト)。 */
  accountId: string | null
}

export interface CapabilityCheck {
  ok: boolean
  /** 非互換時の user-facing メッセージ (tooltip 表示用)。ok のとき null。 */
  reason: string | null
}

/** NoteDeck が理解する capability の一覧。 */
const KNOWN_CAPABILITIES = new Set<string>([
  'misskey-api',
  'misskey-account',
  // Nd:* API (notedeck-api.ts)。accountId 非依存なので追加条件なし。
  'notedeck-api',
])

export function checkWidgetCapabilities(
  capabilities: readonly string[],
  ctx: CapabilityContext,
): CapabilityCheck {
  for (const cap of capabilities) {
    if (!KNOWN_CAPABILITIES.has(cap)) {
      return {
        ok: false,
        reason: `未対応の機能: ${cap} (NoteDeck のアップデートが必要です)`,
      }
    }
    if (cap === 'misskey-api' && ctx.accountId === null) {
      return {
        ok: false,
        reason: 'アカウントが必要です (カラムにアカウントを設定してください)',
      }
    }
    if (cap === 'misskey-account' && ctx.accountId === null) {
      return {
        ok: false,
        reason: 'ログイン済みアカウントが必要です',
      }
    }
  }
  return { ok: true, reason: null }
}
