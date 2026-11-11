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

/** 全アカウントのカラムが束ねる組 (`ColumnSource`) のうち、再結合が見る部分 */
export interface RebindableSource {
  accountId: string
  /** portable な識別子 `user@host` */
  account?: string
}

export interface RebindableColumn {
  id: string
  /** null = 全アカウント (カラム自体は再結合の対象外。組は `sources` で結び直す) */
  accountId: string | null
  /** portable な識別子 `user@host` */
  account?: string
  /** 全アカウントのカラムがアカウントごとに選んだ組 (#1017 案 2、#1354) */
  sources?: readonly RebindableSource[]
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
  /** 1 つの参照を揃える。変わらなければ同じオブジェクト、一致が無ければ null */
  function rebindRef<R extends RebindableSource>(ref: R): R | null {
    const local = byId.get(ref.accountId)
    if (local) {
      const key = portableAccountId(local)
      return key && ref.account !== key ? { ...ref, account: key } : ref
    }
    const target = ref.account ? byPortable.get(ref.account) : undefined
    return target ? { ...ref, accountId: target.id } : null
  }
  const out = columns.map((col) => {
    let next = col
    if (col.sources) {
      const sources = col.sources.map((s) => rebindRef(s) ?? s)
      if (sources.some((s, i) => s !== col.sources?.[i])) {
        next = { ...next, sources }
      }
    }
    if (col.accountId != null) {
      const ref = rebindRef({ accountId: col.accountId, account: col.account })
      if (!ref) unbound.push(col.id)
      else if (ref.accountId !== col.accountId || ref.account !== col.account) {
        next = { ...next, accountId: ref.accountId, account: ref.account }
      }
    }
    if (next !== col) changed = true
    return next
  })
  return { columns: out, changed, unbound }
}

/** この機械に無いアカウントを指す列の `accountId` の印 (`unbound:<user@host>`) */
export const UNBOUND_PREFIX = 'unbound:'

export function isUnboundAccountId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(UNBOUND_PREFIX)
}

/**
 * ファイルに書く形: portable な `account` がある列は `accountId` (この機械の UUID) を
 * 書かない。2 台で同じファイルを共有したとき、起動のたびにお互いの UUID で書き直して
 * 差分が止まらなくなるのを防ぐ。`accountId: null` (全アカウント) とゲストはそのまま
 */
export function stripMachineAccountIds<C extends RebindableColumn>(
  columns: readonly C[],
): C[] {
  return columns.map((col) => {
    let next = col
    if (col.sources?.some((s) => s.account)) {
      next = {
        ...next,
        sources: col.sources.map((s) => {
          if (!s.account) return s
          const { accountId: _machine, ...rest } = s
          return rest as unknown as RebindableSource
        }),
      }
    }
    if (typeof next.accountId !== 'string' || !next.account) return next
    const { accountId: _machine, ...rest } = next
    return rest as unknown as C
  })
}

/**
 * ファイルから読んだ形を整える: `account` があって `accountId` が無い列は、この機械の
 * アカウントが揃うまで `unbound:<user@host>` を置く (`undefined` のままだと全アカウントの
 * 列と見分けがつかない)。再結合 (`rebindColumns`) がこの機械の UUID に置き換える
 */
export function placeholderAccountIds<C extends RebindableColumn>(
  columns: readonly C[],
): C[] {
  return columns.map((col) => {
    let next = col
    if (col.sources?.some((s) => s.accountId === undefined && s.account)) {
      next = {
        ...next,
        sources: col.sources.map((s) =>
          s.accountId !== undefined || !s.account
            ? s
            : { ...s, accountId: `${UNBOUND_PREFIX}${s.account}` },
        ),
      }
    }
    if (next.accountId !== undefined || !next.account) return next
    return { ...next, accountId: `${UNBOUND_PREFIX}${next.account}` }
  })
}
