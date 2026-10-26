import type { QuerySnapshot } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * クエリランタイム (notecore) の購読を開く口 (#1258)。カラムは
 * `createNoteQuerySubscription({ open: () => openTimelineQuery(...) })` の形で
 * 使い、IPC には触らない。戻りは購読 id 入りのスナップショット
 */
export function openTimelineQuery(
  accountId: string,
  timelineType: string,
  listId: string | null = null,
): Promise<QuerySnapshot> {
  return commands
    .querySubscribeTimeline(accountId, timelineType, listId)
    .then(unwrap)
}

export function openAntennaQuery(
  accountId: string,
  antennaId: string,
): Promise<QuerySnapshot> {
  return commands.querySubscribeAntenna(accountId, antennaId).then(unwrap)
}

export function openChannelQuery(
  accountId: string,
  channelId: string,
): Promise<QuerySnapshot> {
  return commands.querySubscribeChannel(accountId, channelId).then(unwrap)
}

export function openMentionsQuery(accountId: string): Promise<QuerySnapshot> {
  return commands.querySubscribeMentions(accountId).then(unwrap)
}

export function openNotificationsQuery(
  accountId: string,
): Promise<QuerySnapshot> {
  return commands.querySubscribeNotifications(accountId).then(unwrap)
}

export function openRoleQuery(
  accountId: string,
  roleId: string,
): Promise<QuerySnapshot> {
  return commands.querySubscribeRole(accountId, roleId).then(unwrap)
}

export function openChatRoomQuery(
  accountId: string,
  roomId: string,
): Promise<QuerySnapshot> {
  return commands.querySubscribeChatRoom(accountId, roomId).then(unwrap)
}

export function openChatUserQuery(
  accountId: string,
  otherId: string,
): Promise<QuerySnapshot> {
  return commands.querySubscribeChatUser(accountId, otherId).then(unwrap)
}
