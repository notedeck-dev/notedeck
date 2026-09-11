/**
 * ウィジェット個体の照合規則 (#1061)。
 *
 * ストア由来のウィジェットは「storeId × 実行アカウント」の組で 1 個体。
 * 実行アカウントは安定キー (`accountScopeKey`) で持ち、未設定は「アカウント無し」
 * の 1 枠として数える (per-account カラムに置く個体・アカウント不要の個体)。
 * 同じ storeId でも実行アカウントが違えば別個体 — AiScript の Mk:save 領域が
 * 個体単位なので、本体を共有するとアカウント間でデータが混ざる。
 */

export interface WidgetInstanceLike {
  installId: string
  storeId?: string
  accountKey?: string
}

/** ストアカードの「インストール済み」判定に使うカラム側の文脈 */
export interface StoreWidgetInstallContext {
  /** アイテムがアカウント必須の capability を宣言しているか */
  requiresAccount: boolean
  scope:
    | { kind: 'all'; accountKeys: readonly string[] }
    | { kind: 'account'; key: string }
}

/** storeId × 実行アカウントの組で個体を引く。accountKey 未指定 = アカウント無しの枠 */
export function findWidgetInstance<T extends WidgetInstanceLike>(
  widgets: readonly T[],
  storeId: string,
  accountKey: string | undefined,
): T | undefined {
  return widgets.find(
    (w) => w.storeId === storeId && (w.accountKey ?? undefined) === accountKey,
  )
}

/** 同 storeId の全個体 (更新の一括適用・baseline 記録用) */
export function listWidgetInstances<T extends WidgetInstanceLike>(
  widgets: readonly T[],
  storeId: string,
): T[] {
  return widgets.filter((w) => w.storeId === storeId)
}

/**
 * ストアカードを「インストール済み」として出すか。
 * - アカウント不要のアイテムは全体で 1 つ → 個体が 1 つでもあれば済み
 * - 全アカウントカラム: 選べるアカウント全部に個体が揃って初めて済み
 *   (未インストールのアカウントが残るうちは通常の状態で出す)。
 *   アカウント無しの個体は数えない — 実行時にアカウントを選ばせて固定される
 *   過渡状態なので、どのアカウントの枠でもない
 * - per-account カラム: アカウント無しの個体 (カラムのアカウントで動く) か、
 *   同じアカウントに固定された個体があれば済み
 */
export function isStoreWidgetInstalled(
  widgets: readonly WidgetInstanceLike[],
  storeId: string,
  ctx: StoreWidgetInstallContext,
): boolean {
  const instances = listWidgetInstances(widgets, storeId)
  if (instances.length === 0) return false
  if (!ctx.requiresAccount) return true
  if (ctx.scope.kind === 'account') {
    const key = ctx.scope.key
    return instances.some((w) => !w.accountKey || w.accountKey === key)
  }
  const keys = ctx.scope.accountKeys
  if (keys.length === 0) return true
  return keys.every((key) => instances.some((w) => w.accountKey === key))
}
