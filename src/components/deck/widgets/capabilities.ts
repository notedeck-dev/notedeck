/**
 * MisStore widget / plugin の `capabilities` 配列と、NoteDeck 側の対応状況
 * (および widget はカラム文脈 accountId) との互換性を判定する。
 *
 * 方針:
 * - 既知 capability は KNOWN_CAPABILITIES に列挙し、各々の要求条件を記述。
 * - 未知 capability は NoteDeck 未対応として非互換扱いにする (将来 MisStore が
 *   新しい capability を導入したとき、NoteDeck 未更新のユーザーが install して
 *   runtime エラーに遭遇するのを防ぐ)。
 * - plugin はカラム文脈を持たないため checkKnownCapabilities のみ使う
 *   (実行時の認可は permissions.json5 の plugin principal 側で gate される)。
 */

export interface CapabilityContext {
  /** Widget カラムの accountId (未設定なら null = cross-account / ゲスト)。 */
  accountId: string | null
}

export interface CapabilityCheck {
  ok: boolean
  /** 非互換時の短いラベル (カードのバッジ表示用)。ok のとき null。 */
  badge: string | null
  /** 非互換時の user-facing メッセージ (tooltip 表示用)。ok のとき null。 */
  reason: string | null
}

/** NoteDeck が理解する capability の一覧。 */
const KNOWN_CAPABILITIES = new Set<string>([
  'misskey-api',
  'misskey-account',
  // Nd:* API (notedeck-api.ts)。accountId 非依存なので追加条件なし。
  'notedeck-api',
  // Secret Vault (vault.fetch)。認可は permissions.json5 の vault.use 側で
  // gate されるため、install 判定では互換とだけ扱う。
  'secret-vault',
])

/** NoteDeck が capability を理解しているかだけを判定する (plugin install 用)。 */
export function checkKnownCapabilities(
  capabilities: readonly string[],
): CapabilityCheck {
  for (const cap of capabilities) {
    if (!KNOWN_CAPABILITIES.has(cap)) {
      return {
        ok: false,
        badge: '要アップデート',
        reason: `未対応の機能: ${cap} (NoteDeck のアップデートが必要です)`,
      }
    }
  }
  return { ok: true, badge: null, reason: null }
}

export function checkWidgetCapabilities(
  capabilities: readonly string[],
  ctx: CapabilityContext,
): CapabilityCheck {
  const known = checkKnownCapabilities(capabilities)
  if (!known.ok) return known
  for (const cap of capabilities) {
    if (cap === 'misskey-api' && ctx.accountId === null) {
      return {
        ok: false,
        badge: '要アカウント',
        reason: 'アカウントが必要です (カラムにアカウントを設定してください)',
      }
    }
    if (cap === 'misskey-account' && ctx.accountId === null) {
      return {
        ok: false,
        badge: '要ログイン',
        reason: 'ログイン済みアカウントが必要です',
      }
    }
  }
  return { ok: true, badge: null, reason: null }
}
