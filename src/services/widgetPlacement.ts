/**
 * ウィジェットの配置 (#1202 決定 (g))。
 *
 * 本体 (`WidgetItem`) は紐付け配列で共有され、実行アカウントを持たない。
 * 「どのアカウントで動かすか」はカラム側の配置が持つ:
 * - per-account カラム: `accountKey` を省略 = カラムのアカウントで動く
 * - 全アカウントカラム (サイドバーを含む): `accountKey` (`accountScopeKey`) が
 *   必須。同じ本体を alice 用と bob 用に 2 つ置く使い方は配置の重複で表す
 *
 * Mk:save の実行状態は `app-<installId>/<accountKey>` で名前空間を分ける
 * (決定 (h))。アカウントが決まらない配置 (全アカウントカラムで未選択) は旧来の
 * `app-<installId>` を使う。区切りが `/` なのは、旧来の鍵
 * (`nd-aiscript-app-<installId>:<key>`) の prefix と名前空間つきの鍵が
 * 重ならないようにするため (アカウントキーにも Mk:save の鍵にも `:` が入る)
 */

export interface WidgetPlacement {
  /** 本体の installId */
  id: string
  /** 実行アカウントの安定キー。省略 = カラムのアカウント */
  accountKey?: string
}

export function samePlacement(a: WidgetPlacement, b: WidgetPlacement): boolean {
  return a.id === b.id && (a.accountKey ?? null) === (b.accountKey ?? null)
}

/** 旧形式 (`widgetIds: string[]`) → 配置。実行アカウントは移行が後から足す */
export function placementsFromIds(ids: readonly string[]): WidgetPlacement[] {
  return ids.map((id) => ({ id }))
}

/**
 * 複製の統合 (決定 (i)) / 固定の解除 (決定 (g)) で配置を書き換える規則。
 * `from` を参照する配置は `to.id` を指し、実行アカウントが未指定なら
 * `to.accountKey` を引き継ぐ (旧形式では本体が実行アカウントを持っていた)
 */
export interface WidgetPlacementRewrite {
  from: string
  to: WidgetPlacement
}

export function rewritePlacements(
  placements: readonly WidgetPlacement[],
  rewrites: readonly WidgetPlacementRewrite[],
): { placements: WidgetPlacement[]; changed: boolean } {
  if (rewrites.length === 0)
    return { placements: [...placements], changed: false }
  const byFrom = new Map(rewrites.map((r) => [r.from, r.to]))
  let changed = false
  const out: WidgetPlacement[] = []
  for (const p of placements) {
    const to = byFrom.get(p.id)
    if (!to) {
      out.push(p)
      continue
    }
    const next: WidgetPlacement = {
      id: to.id,
      ...((p.accountKey ?? to.accountKey)
        ? { accountKey: p.accountKey ?? to.accountKey }
        : {}),
    }
    changed = true
    // 同じ配置が既にあれば重複させない (統合で 2 つが 1 つに畳まれる)
    if (out.some((q) => samePlacement(q, next))) continue
    out.push(next)
  }
  return { placements: out, changed }
}

/** AiScript の Mk:save / Mk:load の名前空間 (`storagePrefix`) */
export function widgetStoragePrefix(
  installId: string,
  accountKey: string | undefined,
): string {
  return accountKey ? `app-${installId}/${accountKey}` : `app-${installId}`
}

/** 名前空間化の前の鍵 (Mk:load の fallback、決定 (h)) */
export function legacyWidgetStoragePrefix(installId: string): string {
  return `app-${installId}`
}
