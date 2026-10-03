/**
 * サーバー検索の範囲の選択肢を決めるために、サーバーが公開する検索範囲の設定
 * (meta の該当項目だけ) を読む (#1180)。既に取得しているサーバー情報と同じ
 * 寿命で持ち、パネルを開くたびに問い合わせない。読めなかったサーバーは
 * 「設定を返さないサーバー」と同じ扱い (ローカルだけ) にする。
 */
import { type Ref, ref, watchEffect } from 'vue'
import type { SearchScopeMeta } from '@/services/searchFilter'
import { commands, unwrap } from '@/utils/tauriInvoke'

const cache = new Map<string, Promise<SearchScopeMeta>>()

async function fetchScopeMeta(accountId: string): Promise<SearchScopeMeta> {
  try {
    const meta = unwrap(await commands.apiGetMetaDetail(accountId)) as {
      noteSearchableScope?: string | null
      federation?: string | null
    } | null
    return {
      noteSearchableScope: meta?.noteSearchableScope ?? null,
      federation: meta?.federation ?? null,
    }
  } catch {
    return {}
  }
}

export function loadSearchScopeMeta(
  accountId: string,
): Promise<SearchScopeMeta> {
  let p = cache.get(accountId)
  if (!p) {
    p = fetchScopeMeta(accountId)
    cache.set(accountId, p)
  }
  return p
}

/** テスト用: キャッシュを捨てる */
export function resetSearchScopeMetaCache(): void {
  cache.clear()
}

/** 指定アカウントの設定。読み終わるまでは null (= 選択肢を出さない) */
export function useSearchScopeMeta(
  accountId: Ref<string | null | undefined>,
): Ref<SearchScopeMeta | null> {
  const meta = ref<SearchScopeMeta | null>(null)
  watchEffect(() => {
    const id = accountId.value
    meta.value = null
    if (!id) return
    loadSearchScopeMeta(id).then((m) => {
      if (accountId.value === id) meta.value = m
    })
  })
  return meta
}
