import { type DistributableScope, isInScope } from '@/services/distributable'

/**
 * ウィジェット本体の照合規則 (#1202 決定 (b))。
 *
 * ストア由来のウィジェットは storeId につき本体 1 つ (照合は storeId のみ、#913)。
 * どのアカウントのカラムで選べるかは紐付け配列 (`scope`) が持ち、実行
 * アカウントは配置 (`services/widgetPlacement.ts`) が持つ。Mk:save の状態は
 * 実行アカウントで名前空間が分かれるので、本体を共有しても混ざらない
 */

export interface WidgetBodyLike {
  id: string
  store?: { id: string }
  scope: DistributableScope
}

/** ストアカードの「インストール済み」判定に使うカラム側の文脈 */
export interface StoreWidgetInstallContext {
  /** アイテムがアカウント必須の capability を宣言しているか */
  requiresAccount: boolean
  scope:
    | { kind: 'all'; accountKeys: readonly string[] }
    | { kind: 'account'; key: string }
}

/** storeId で本体を引く */
export function findWidgetByStore<T extends WidgetBodyLike>(
  widgets: readonly T[],
  storeId: string,
): T | undefined {
  return widgets.find((w) => w.store?.id === storeId)
}

/**
 * ストアカードを「インストール済み」として出すか。
 * - アカウント不要のアイテムは本体があれば済み
 * - per-account カラム: そのアカウントで選べる (全体か、紐付けにある) なら済み
 * - 全アカウントカラム: 全体か、選べるアカウント全部が紐付けにあって初めて済み
 *   (未参加のアカウントが残るうちは通常の状態で出し、押せば参加させる。
 *   プラグインのスコープ別判定と同じ粒度)
 */
export function isStoreWidgetInstalled(
  widgets: readonly WidgetBodyLike[],
  storeId: string,
  ctx: StoreWidgetInstallContext,
): boolean {
  const body = findWidgetByStore(widgets, storeId)
  if (!body) return false
  if (!ctx.requiresAccount) return true
  if (ctx.scope.kind === 'account') return isInScope(body.scope, ctx.scope.key)
  return ctx.scope.accountKeys.every((key) => isInScope(body.scope, key))
}
