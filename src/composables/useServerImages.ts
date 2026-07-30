import { computed } from 'vue'
import type { ServerInfo } from '@/adapters/types'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { proxyThumbUrl, proxyUrl } from '@/utils/mediaProxy'

/** "user@host" のような portable account ID から host 部分を取り出す */
function hostFromPortableAccount(portable: string | undefined): string | null {
  if (!portable) return null
  const at = portable.lastIndexOf('@')
  return at >= 0 ? portable.slice(at + 1) : null
}

/**
 * カラムのアカウントに紐づくサーバーのカスタム画像 URL を返す。
 * useColumnSetup を使わないカラム（useColumnTheme のみ）でも利用可能。
 *
 * アカウントが見つからない（削除済み等）場合でも、カラムが保持する portable
 * account ID (`user@host`) から host を復元して server info を引く。
 * 横断カラム（accountId も portable も無い）では undefined を返し、
 * 特定サーバーのブランディング画像がフォールバックで表示されないようにする。
 */
export function useServerImages(getColumn: () => DeckColumn) {
  const accountsStore = useAccountsStore()
  const serversStore = useServersStore()

  const serverInfo = computed<ServerInfo | undefined>(() => {
    const col = getColumn()
    const acc = accountsStore.accounts.find((a) => a.id === col.accountId)
    const host = acc?.host ?? hostFromPortableAccount(col.account)
    if (!host) return undefined
    return serversStore.getServer(host)
  })

  // プロキシ経由にしてディスクキャッシュとサーキットブレーカーに載せる。
  // アイコンはバッジ表示なのでリサイズも掛ける
  const serverIconUrl = computed(() =>
    proxyThumbUrl(serverInfo.value?.iconUrl, 28),
  )
  const serverInfoImageUrl = computed(() =>
    proxyUrl(serverInfo.value?.infoImageUrl),
  )
  const serverNotFoundImageUrl = computed(() =>
    proxyUrl(serverInfo.value?.notFoundImageUrl),
  )
  const serverErrorImageUrl = computed(() =>
    proxyUrl(serverInfo.value?.serverErrorImageUrl),
  )

  return {
    serverIconUrl,
    serverInfoImageUrl,
    serverNotFoundImageUrl,
    serverErrorImageUrl,
  }
}
