import { useRouter } from 'vue-router'
import { useDeckStore } from '@/stores/deck'
import { useWindowsStore } from '@/stores/windows'

export function useNavigation() {
  const router = useRouter()
  const windowsStore = useWindowsStore()
  const deckStore = useDeckStore()

  function isDeckActive(): boolean {
    const name = router.currentRoute.value.name
    // PiP ウィンドウ内もデッキ扱いにして windowsStore.open() に流す。
    // store 側で PiP コンテキストを検知して新規 PiP ウィンドウにリダイレクトする。
    return name === 'deck' || name === 'pip'
  }

  function navigateToNote(accountId: string, noteId: string) {
    if (isDeckActive()) {
      windowsStore.open('note-detail', { accountId, noteId })
    } else {
      router.push(`/note/${accountId}/${noteId}`)
    }
  }

  function navigateToUser(accountId: string, userId: string) {
    if (isDeckActive()) {
      windowsStore.open('user-profile', { accountId, userId })
    } else {
      router.push(`/user/${accountId}/${userId}`)
    }
  }

  function navigateToChannel(
    accountId: string,
    channelId: string,
    name?: string,
  ) {
    if (!isDeckActive()) {
      router.push('/deck')
    }
    const existing = deckStore.columns.find(
      (c) => c.type === 'channel' && c.channelId === channelId,
    )
    if (existing) {
      deckStore.setActiveColumn(existing.id)
      return
    }
    deckStore.addColumn({
      type: 'channel',
      accountId,
      channelId,
      name: name ?? null,
      width: 360,
    })
  }

  function navigateToLogin(host?: string) {
    // ログインは常にデッキ内ウィンドウ (#692)。DeckWindowLayer は App.vue
    // 直下 (PiP 以外) にあるため、どのルートからでも開ける。
    windowsStore.open('login', host ? { initialHost: host } : {})
  }

  function toggleOrOpenColumn(
    type: 'notifications' | 'search' | 'chat' | 'ai',
  ) {
    if (!isDeckActive()) {
      router.push('/deck')
    }
    deckStore.toggleSidebarColumn(type, null)
  }

  function navigateToSearch() {
    toggleOrOpenColumn('search')
  }

  /** ハッシュタグクリックから検索カラムを `#tag` クエリ付きで開く。 */
  function navigateToHashtag(tag: string) {
    if (!isDeckActive()) {
      router.push('/deck')
    }
    deckStore.openSearchWith(`#${tag}`)
  }

  function navigateToNotifications() {
    toggleOrOpenColumn('notifications')
  }

  function navigateToAi() {
    toggleOrOpenColumn('ai')
  }

  function navigateToChat() {
    toggleOrOpenColumn('chat')
  }

  return {
    navigateToNote,
    navigateToUser,
    navigateToChannel,
    navigateToLogin,
    navigateToSearch,
    navigateToHashtag,
    navigateToNotifications,
    navigateToAi,
    navigateToChat,
  }
}
