/**
 * 全アカウントカラムの取得単位 (#1017 案 2)。
 *
 * リスト / アンテナ / クリップ / チャンネル / ロール / ユーザーの ID はサーバーに
 * 閉じているので、「全アカウント」は「アカウントごとに選んだリソースを束ねる」の
 * 意味になる。カラムは `accountId: null` + 組 (`sources`) の配列を持ち、取得・
 * 遡り・購読は組ごとに行う。名前は ID にならない (#1058 と同じ理由) ので、
 * `name` は表示用の写しにすぎない。
 *
 * 全アカウントを 1 回ずつ回す面 (TL / メンション / お気に入り等) は `id` が空の
 * 組 (`accountSource`) として同じ経路に乗る。
 */

export interface ColumnSource {
  /** 取得元アカウント (per-account カラムの `accountId` と同じ内部 ID) */
  accountId: string
  /** サーバーに閉じたリソースの ID。アカウント単位の面では空文字 */
  id: string
  /** 表示用の写し (リスト名など)。正本はサーバーで、同一性には使わない */
  name?: string
}

export type SourceKey = string & { readonly __brand: 'SourceKey' }

/** ID にもアカウント ID にも現れない制御文字 (U+001F) で連結する (noteKey と同じ) */
const SEP = '\u001f'

export function sourceKey(source: Pick<ColumnSource, 'accountId' | 'id'>) {
  return `${source.accountId}${SEP}${source.id}` as SourceKey
}

export function parseSourceKey(key: SourceKey): {
  accountId: string
  id: string
} {
  const idx = key.indexOf(SEP)
  if (idx < 0) return { accountId: key, id: '' }
  return { accountId: key.slice(0, idx), id: key.slice(idx + 1) }
}

/** アカウント単位の面の組 (リソース ID を持たない) */
export function accountSource(accountId: string): ColumnSource {
  return { accountId, id: '' }
}

export function sameSource(
  a: Pick<ColumnSource, 'accountId' | 'id'>,
  b: Pick<ColumnSource, 'accountId' | 'id'>,
): boolean {
  return a.accountId === b.accountId && a.id === b.id
}

/** 保存された組の正規化: 空の ID と重複を落とす (順序は保つ) */
export function normalizeSources(
  sources: readonly ColumnSource[] | undefined,
): ColumnSource[] {
  if (!sources) return []
  const seen = new Set<SourceKey>()
  const out: ColumnSource[] = []
  for (const s of sources) {
    if (!s.accountId || !s.id) continue
    const key = sourceKey(s)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** アカウント削除の後始末: そのアカウントの組を外す */
export function withoutAccountSources(
  sources: readonly ColumnSource[],
  accountId: string,
): ColumnSource[] {
  return sources.filter((s) => s.accountId !== accountId)
}
