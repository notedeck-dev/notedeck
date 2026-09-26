import { useUnreadCounter } from '@/composables/useUnreadCounter'
import { commands, unwrap } from '@/utils/tauriInvoke'

async function fetchUnreadCount(accountId: string): Promise<number> {
  try {
    const result = unwrap(await commands.apiGetUnreadChat(accountId))
    return result ? 1 : 0
  } catch {
    return 0
  }
}

export function useUnreadChat() {
  const { totalUnread, counts, fetchAll, resetAll } = useUnreadCounter('chat', {
    pollIntervalKey: 'chatPollInterval',
    fetchCount: fetchUnreadCount,
    onUnread: (event, current) => {
      if (event.kind !== 'chat' || event.op !== 'increment') return null
      return current + 1
    },
  })

  return { totalUnread, counts, fetchAll, resetAll }
}
