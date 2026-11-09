/**
 * プロファイルのカラムを `account: user@host` でその機械のアカウントに再結合する (#1332)。
 *
 * カラムは `accountId` (その機械の DB が発行する UUID) でアカウントを指すが、UUID は
 * 機械ごとの値で、設定フォルダを別の機械に持ち込む (バックアップの復元、Git での
 * clone、同期) とカラムはアカウントを失う。保存時に portable な `account` (user@host)
 * も書いておき、読んだときに `accountId` がその機械に無ければ `account` が一致する
 * アカウントに付け替える。
 *
 * 判断 (issue): 再結合の鍵は `user@host` だけ。`host` の別名や移住は追わない。内部 UUID
 * を持ち出す案は採らない (同じ値を別の機械で再現する経路が無い)。
 */

export interface RebindableAccount {
  id: string
  host: string
  username: string
  userId: string
  hasToken: boolean
}

export interface RebindableColumn {
  id: string
  /** null = 全アカウント (再結合の対象外) */
  accountId: string | null
  /** portable な識別子 `user@host` */
  account?: string
}

const GUEST_USER_ID = '__guest__'

/** `user@host`。ゲスト (トークン無し) は機械固有なので null */
export function portableAccountId(acc: RebindableAccount): string | null {
  if (acc.userId === GUEST_USER_ID && !acc.hasToken) return null
  if (!acc.username) return null
  return `${acc.username}@${acc.host}`
}

export interface RebindResult<C extends RebindableColumn> {
  columns: C[]
  /** accountId を付け替えた / account を埋めたカラムがあるか */
  changed: boolean
  /** この機械に無く、再結合もできなかった (アカウント未接続のまま残す) カラム id */
  unbound: string[]
}

/**
 * カラムの `accountId` をこの機械のアカウントに揃える。
 *
 * - `accountId` がこの機械にある → `account` が無ければ埋める
 * - 無く、`account` が一致するアカウントがある → `accountId` を付け替える
 * - どちらも無い → そのまま残す (`unbound`)。そのアカウントでログインしたら次の呼出で結ぶ
 */
export function rebindColumns<C extends RebindableColumn>(
  columns: readonly C[],
  accounts: readonly RebindableAccount[],
): RebindResult<C> {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const byPortable = new Map<string, RebindableAccount>()
  for (const a of accounts) {
    const key = portableAccountId(a)
    if (key && !byPortable.has(key)) byPortable.set(key, a)
  }
  let changed = false
  const unbound: string[] = []
  const out = columns.map((col) => {
    if (col.accountId == null) return col
    const local = byId.get(col.accountId)
    if (local) {
      const key = portableAccountId(local)
      if (key && col.account !== key) {
        changed = true
        return { ...col, account: key }
      }
      return col
    }
    const target = col.account ? byPortable.get(col.account) : undefined
    if (target) {
      changed = true
      return { ...col, accountId: target.id }
    }
    unbound.push(col.id)
    return col
  })
  return { columns: out, changed, unbound }
}
