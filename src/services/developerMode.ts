/**
 * 開発者モードの初期値を決める (#1034 決定録 2 / 検証録 修正 7)。
 *
 * 既存インストールは全員 on、新規インストールのみ off。判定に settings.json5 の
 * キー有無を使わないのは、スカラー設定を一度も変えていない既存ユーザーが
 * 「キーが無い」状態になり、新規と区別できないため。実際に使った痕跡
 * (アカウント / 開発者向け設定ファイル) を信号にする。
 */

export interface DeveloperModeSignals {
  /** notecli.db にアカウントが 1 つ以上ある */
  hasAccounts: boolean
  /** ai.json5 / tasks.json5 など、開発者向け機能を使った痕跡がある */
  hasDeveloperArtifacts: boolean
}

/**
 * @param saved settings.json5 に保存済みの値 (未決定なら undefined)
 */
export function resolveDeveloperMode(
  saved: boolean | undefined,
  signals: DeveloperModeSignals,
): boolean {
  if (saved !== undefined) return saved
  return signals.hasAccounts || signals.hasDeveloperArtifacts
}
