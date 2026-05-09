import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type {
  ActiveUsersChart,
  Antenna,
  ApiAdapter,
  ApRequestChart,
  Channel,
  ChatMessage,
  Clip,
  CreateNoteParams,
  FederationChart,
  FederationInstance,
  FederationInstancesParams,
  FollowRelation,
  NormalizedDriveFile,
  NormalizedNote,
  NormalizedNotification,
  NormalizedUser,
  NormalizedUserDetail,
  NoteReaction,
  PaginationOptions,
  SearchOptions,
  ServerDriveChart,
  ServerEmoji,
  ServerNotesChart,
  ServerUsersChart,
  TimelineOptions,
  TimelineType,
  UserFollowingChart,
  UserList,
  UserNotesChart,
  UserNotesOptions,
  UserPvChart,
  UserRelation,
} from '../types'

/**
 * bindings.ts と adapters/types.ts で同名の型が別定義されているため、
 * unwrap() の戻り値を any にキャストして型不一致を回避する。
 * 以前の invoke() が any を返していたのと同等の安全性。
 */
function unwrapAny(
  result: { status: string; data?: unknown; error?: unknown },
  // biome-ignore lint/suspicious/noExplicitAny: bridge between bindings and adapter types
): any {
  return unwrap(result as Parameters<typeof unwrap>[0])
}

export class MisskeyApi implements ApiAdapter {
  private accountId: string
  private hasToken: boolean

  constructor(accountId: string, _host: string, hasToken = true) {
    this.accountId = accountId
    this.hasToken = hasToken
  }

  private requireAuth(): void {
    if (!this.hasToken) throw new AppError('AUTH', 'ログインが必要です')
  }

  async getTimeline(
    type: TimelineType,
    options: TimelineOptions = {},
  ): Promise<NormalizedNote[]> {
    // OGP prefetch is handled asynchronously on the Rust side via Tauri events
    return unwrapAny(
      await commands.apiGetTimeline(this.accountId, type, {
        limit: options.limit ?? 20,
        sinceId: options.sinceId ?? null,
        untilId: options.untilId ?? null,
        filters: (options.filters ?? null) as never,
        listId: options.listId ?? null,
      }),
    )
  }

  async getNote(noteId: string): Promise<NormalizedNote> {
    return unwrapAny(await commands.apiGetNote(this.accountId, noteId))
  }

  async createReaction(noteId: string, reaction: string): Promise<void> {
    this.requireAuth()
    unwrapAny(
      await commands.apiCreateReaction(this.accountId, noteId, reaction),
    )
  }

  async deleteReaction(noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiDeleteReaction(this.accountId, noteId))
  }

  async votePoll(noteId: string, choice: number): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiVotePoll(this.accountId, noteId, choice))
  }

  async getNoteReactions(
    noteId: string,
    reactionType?: string,
    limit?: number,
    untilId?: string,
  ): Promise<NoteReaction[]> {
    return unwrapAny(
      await commands.apiGetNoteReactions(
        this.accountId,
        noteId,
        reactionType ?? null,
        limit ?? null,
        untilId ?? null,
      ),
    )
  }

  async updateNote(noteId: string, params: CreateNoteParams): Promise<void> {
    this.requireAuth()
    unwrapAny(
      await commands.apiUpdateNote(this.accountId, noteId, params as never),
    )
  }

  async deleteNote(noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiDeleteNote(this.accountId, noteId))
  }

  async uploadFile(
    fileName: string,
    fileData: number[],
    contentType: string,
    isSensitive = false,
    folderId: string | null = null,
  ): Promise<NormalizedDriveFile> {
    this.requireAuth()
    return unwrapAny(
      await commands.apiUploadFile(
        this.accountId,
        fileName,
        fileData,
        contentType,
        isSensitive,
        folderId,
      ),
    )
  }

  async uploadFileFromPath(
    filePath: string,
    isSensitive = false,
    folderId: string | null = null,
  ): Promise<NormalizedDriveFile> {
    this.requireAuth()
    return unwrapAny(
      await commands.apiUploadFileFromPath(
        this.accountId,
        filePath,
        isSensitive,
        folderId,
      ),
    )
  }

  async createFavorite(noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiCreateFavorite(this.accountId, noteId))
  }

  async deleteFavorite(noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiDeleteFavorite(this.accountId, noteId))
  }

  async pinNote(noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiPinNote(this.accountId, noteId))
  }

  async unpinNote(noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiUnpinNote(this.accountId, noteId))
  }

  async getUserPinnedNoteIds(userId: string): Promise<string[]> {
    return unwrapAny(
      await commands.apiGetUserPinnedNoteIds(this.accountId, userId),
    )
  }

  async getUser(userId: string): Promise<NormalizedUser> {
    return unwrapAny(await commands.apiGetUser(this.accountId, userId))
  }

  async getUserDetail(userId: string): Promise<NormalizedUserDetail> {
    return unwrapAny(await commands.apiGetUserDetail(this.accountId, userId))
  }

  async getUserNotes(
    userId: string,
    options: UserNotesOptions = {},
  ): Promise<NormalizedNote[]> {
    const { withReplies, withFiles, withChannelNotes, ...pagination } = options
    const hasFilters =
      withReplies != null || withFiles != null || withChannelNotes != null

    if (hasFilters && this.hasToken) {
      const params: Record<string, unknown> = {
        userId,
        limit: pagination.limit ?? 20,
      }
      if (pagination.untilId) params.untilId = pagination.untilId
      if (pagination.sinceId) params.sinceId = pagination.sinceId
      if (withReplies != null) params.withReplies = withReplies
      if (withFiles != null) params.withFiles = withFiles
      if (withChannelNotes != null) params.withChannelNotes = withChannelNotes

      const raw: { id: string }[] = unwrapAny(
        await commands.apiGetUserNotesFiltered(this.accountId, params as never),
      )
      if (!raw.length) return []
      return Promise.all(raw.map((n) => this.getNote(n.id)))
    }

    return unwrapAny(
      await commands.apiGetUserNotes(this.accountId, userId, {
        limit: pagination.limit ?? 20,
        sinceId: pagination.sinceId ?? null,
        untilId: pagination.untilId ?? null,
        filters: null,
      } as never),
    )
  }

  async getUserFeaturedNotes(
    userId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    try {
      const raw: { id: string }[] = unwrapAny(
        await commands.apiGetUserFeaturedNotes(
          this.accountId,
          userId,
          options.limit ?? 30,
          options.untilId ?? null,
        ),
      )
      if (!raw.length) return []
      return Promise.all(raw.map((n) => this.getNote(n.id)))
    } catch {
      return this.getUserNotes(userId, { limit: options.limit ?? 20 })
    }
  }

  async getUserNotesChart(
    userId: string,
    span: 'day' | 'hour' = 'day',
    limit = 350,
  ): Promise<UserNotesChart> {
    return unwrap(
      await commands.apiChartsUserNotes(this.accountId, {
        userId,
        span,
        limit,
      }),
    )
  }

  async getUserFollowingChart(
    userId: string,
    span: 'day' | 'hour' = 'day',
    limit = 30,
  ): Promise<UserFollowingChart> {
    return unwrap(
      await commands.apiChartsUserFollowing(this.accountId, {
        userId,
        span,
        limit,
      }),
    )
  }

  async getUserPvChart(
    userId: string,
    span: 'day' | 'hour' = 'day',
    limit = 30,
  ): Promise<UserPvChart> {
    return unwrap(
      await commands.apiChartsUserPv(this.accountId, { userId, span, limit }),
    )
  }

  async getActiveUsersChart(
    span: 'day' | 'hour' = 'day',
    limit = 90,
  ): Promise<ActiveUsersChart> {
    return unwrap(
      await commands.apiChartsActiveUsers(this.accountId, { span, limit }),
    )
  }

  async getServerNotesChart(
    span: 'day' | 'hour' = 'day',
    limit = 90,
  ): Promise<ServerNotesChart> {
    return unwrap(
      await commands.apiChartsNotes(this.accountId, { span, limit }),
    )
  }

  async getServerUsersChart(
    span: 'day' | 'hour' = 'day',
    limit = 90,
  ): Promise<ServerUsersChart> {
    return unwrap(
      await commands.apiChartsUsers(this.accountId, { span, limit }),
    )
  }

  async getFederationChart(
    span: 'day' | 'hour' = 'day',
    limit = 90,
  ): Promise<FederationChart> {
    return unwrap(
      await commands.apiChartsFederation(this.accountId, { span, limit }),
    )
  }

  async getApRequestChart(
    span: 'day' | 'hour' = 'day',
    limit = 90,
  ): Promise<ApRequestChart> {
    return unwrap(
      await commands.apiChartsApRequest(this.accountId, { span, limit }),
    )
  }

  async getServerDriveChart(
    span: 'day' | 'hour' = 'day',
    limit = 90,
  ): Promise<ServerDriveChart> {
    return unwrap(
      await commands.apiChartsDrive(this.accountId, { span, limit }),
    )
  }

  async getFederationInstances(
    params: FederationInstancesParams = {},
  ): Promise<FederationInstance[]> {
    return unwrap(
      await commands.apiGetFederationInstances(this.accountId, {
        limit: params.limit ?? 30,
        offset: params.offset ?? 0,
        sort: params.sort ?? '-pubSub',
        host: params.host ?? null,
        blocked: params.blocked ?? null,
        notResponding: params.notResponding ?? null,
        suspended: params.suspended ?? null,
        federating: params.federating ?? null,
        subscribing: params.subscribing ?? null,
        publishing: params.publishing ?? null,
      }),
    )
  }

  async getFederationInstance(host: string): Promise<FederationInstance> {
    return unwrap(
      await commands.apiGetFederationInstance(this.accountId, { host }),
    )
  }

  async createNote(params: CreateNoteParams): Promise<NormalizedNote> {
    this.requireAuth()
    const { channelId, ...noteParams } = params
    return unwrapAny(
      await commands.apiCreateNote(
        this.accountId,
        noteParams as never,
        channelId ?? null,
      ),
    )
  }

  async getServerEmojis(): Promise<ServerEmoji[]> {
    return unwrapAny(await commands.apiGetServerEmojis(this.accountId))
  }

  async getPinnedReactions(): Promise<string[]> {
    return unwrapAny(await commands.apiGetPinnedReactions(this.accountId))
  }

  async getNotifications(
    options: PaginationOptions = {},
  ): Promise<NormalizedNotification[]> {
    return unwrapAny(
      await commands.apiGetNotifications(this.accountId, {
        limit: options.limit ?? 20,
        sinceId: options.sinceId ?? null,
        untilId: options.untilId ?? null,
      } as never),
    )
  }

  async getNotificationsGrouped(
    options: PaginationOptions = {},
  ): Promise<NormalizedNotification[]> {
    return unwrapAny(
      await commands.apiGetNotificationsGrouped(this.accountId, {
        limit: options.limit ?? 20,
        sinceId: options.sinceId ?? null,
        untilId: options.untilId ?? null,
      } as never),
    )
  }

  async searchNotes(
    query: string,
    options: SearchOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiSearchNotes(this.accountId, query, {
        limit: options.limit ?? 20,
        sinceId: options.sinceId ?? null,
        untilId: options.untilId ?? null,
        sinceDate: options.sinceDate ?? null,
        untilDate: options.untilDate ?? null,
      }),
    )
  }

  async getNoteChildren(
    noteId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetNoteChildren(
        this.accountId,
        noteId,
        options.limit ?? 30,
      ),
    )
  }

  async getNoteRenotes(
    noteId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetNoteRenotes(
        this.accountId,
        noteId,
        options.limit ?? 30,
      ),
    )
  }

  async getNoteConversation(
    noteId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetNoteConversation(
        this.accountId,
        noteId,
        options.limit ?? 30,
      ),
    )
  }

  async lookupUser(
    username: string,
    host?: string | null,
  ): Promise<NormalizedUser> {
    return unwrapAny(
      await commands.apiLookupUser(this.accountId, username, host ?? null),
    )
  }

  async followUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiFollowUser(this.accountId, userId))
  }

  async unfollowUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiUnfollowUser(this.accountId, userId))
  }

  async invalidateFollower(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiInvalidateFollower(this.accountId, userId))
  }

  async acceptFollowRequest(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiAcceptFollowRequest(this.accountId, userId))
  }

  async rejectFollowRequest(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiRejectFollowRequest(this.accountId, userId))
  }

  async getUserLists(): Promise<UserList[]> {
    return unwrapAny(await commands.apiGetUserLists(this.accountId))
  }

  async getAntennas(): Promise<Antenna[]> {
    return unwrapAny(await commands.apiGetAntennas(this.accountId))
  }

  async getAntennaNotes(
    antennaId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetAntennaNotes(
        this.accountId,
        antennaId,
        options.limit ?? 20,
        options.sinceId ?? null,
        options.untilId ?? null,
      ),
    )
  }

  async getMentions(
    options: PaginationOptions & { visibility?: string } = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetMentions(
        this.accountId,
        options.limit ?? 20,
        options.sinceId ?? null,
        options.untilId ?? null,
        options.visibility ?? null,
      ),
    )
  }

  async getFavorites(
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetFavorites(
        this.accountId,
        options.limit ?? 20,
        options.sinceId ?? null,
        options.untilId ?? null,
      ),
    )
  }

  async getFeaturedNotes(
    options: { limit?: number } = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetFeaturedNotes(this.accountId, options.limit ?? 30),
    )
  }

  async getClips(): Promise<Clip[]> {
    return unwrapAny(await commands.apiGetClips(this.accountId))
  }

  async getClipNotes(
    clipId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetClipNotes(
        this.accountId,
        clipId,
        options.limit ?? 20,
        options.sinceId ?? null,
        options.untilId ?? null,
      ),
    )
  }

  async getChannels(): Promise<Channel[]> {
    return unwrapAny(await commands.apiGetChannels(this.accountId))
  }

  async getChannelNotes(
    channelId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetChannelNotes(
        this.accountId,
        channelId,
        options.limit ?? 20,
        options.sinceId ?? null,
        options.untilId ?? null,
      ),
    )
  }

  async getRoleNotes(
    roleId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    return unwrapAny(
      await commands.apiGetRoleNotes(
        this.accountId,
        roleId,
        options.limit ?? 20,
        options.sinceId ?? null,
        options.untilId ?? null,
      ),
    )
  }

  async getChatHistory(
    limit?: number,
    cache?: boolean | null,
  ): Promise<ChatMessage[]> {
    return unwrapAny(
      await commands.apiGetChatHistory(
        this.accountId,
        limit ?? 100,
        null,
        cache ?? null,
      ),
    )
  }

  async getChatUserMessages(
    userId: string,
    options: PaginationOptions & { cache?: boolean | null } = {},
  ): Promise<ChatMessage[]> {
    return unwrapAny(
      await commands.apiGetChatUserMessages(
        this.accountId,
        userId,
        options.limit ?? 30,
        options.sinceId ?? null,
        options.untilId ?? null,
        options.cache ?? null,
      ),
    )
  }

  async getChatRoomMessages(
    roomId: string,
    options: PaginationOptions & { cache?: boolean | null } = {},
  ): Promise<ChatMessage[]> {
    return unwrapAny(
      await commands.apiGetChatRoomMessages(
        this.accountId,
        roomId,
        options.limit ?? 30,
        options.sinceId ?? null,
        options.untilId ?? null,
        options.cache ?? null,
      ),
    )
  }

  /** ローカル DB から chat history (各 thread の最新 1 件) を取得する (#460)。 */
  async getCachedChatHistory(limit?: number): Promise<ChatMessage[]> {
    return unwrapAny(
      await commands.apiGetCachedChatHistory(this.accountId, limit ?? 100),
    )
  }

  /** ローカル DB から chat thread のメッセージを取得する。 */
  async getCachedChatThreadMessages(
    threadId: string,
    options: { limit?: number; untilId?: string | null } = {},
  ): Promise<ChatMessage[]> {
    return unwrapAny(
      await commands.apiGetCachedChatThreadMessages(
        this.accountId,
        threadId,
        options.untilId ?? null,
        options.limit ?? 30,
      ),
    )
  }

  /** Gap 検出用: 該当 thread の DB 最新 message id (since_id 計算)。 */
  async getCachedChatLatestMessageId(threadId: string): Promise<string | null> {
    return unwrapAny(
      await commands.apiGetCachedChatLatestMessageId(this.accountId, threadId),
    )
  }

  async createChatMessage(params: {
    userId?: string
    roomId?: string
    text?: string
    fileId?: string
  }): Promise<ChatMessage> {
    this.requireAuth()
    return unwrapAny(
      await commands.apiCreateChatMessage(
        this.accountId,
        params.userId ?? null,
        params.roomId ?? null,
        params.text ?? null,
        params.fileId ?? null,
      ),
    )
  }

  async muteUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiMuteUser(this.accountId, userId))
  }

  async unmuteUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiUnmuteUser(this.accountId, userId))
  }

  async renoteMuteUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiRenoteMuteUser(this.accountId, userId))
  }

  async unrenoteMuteUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiUnrenoteMuteUser(this.accountId, userId))
  }

  async blockUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiBlockUser(this.accountId, userId))
  }

  async unblockUser(userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiUnblockUser(this.accountId, userId))
  }

  async reportUser(userId: string, comment: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiReportUser(this.accountId, userId, comment))
  }

  async addNoteToClip(clipId: string, noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiAddNoteToClip(this.accountId, clipId, noteId))
  }

  async removeNoteFromClip(clipId: string, noteId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(
      await commands.apiRemoveNoteFromClip(this.accountId, clipId, noteId),
    )
  }

  async addUserToList(listId: string, userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(await commands.apiAddUserToList(this.accountId, listId, userId))
  }

  async removeUserFromList(listId: string, userId: string): Promise<void> {
    this.requireAuth()
    unwrapAny(
      await commands.apiRemoveUserFromList(this.accountId, listId, userId),
    )
  }

  async getFollowing(
    userId: string,
    options: { limit?: number; untilId?: string } = {},
  ): Promise<FollowRelation[]> {
    return unwrapAny(
      await commands.apiGetFollowing(
        this.accountId,
        userId,
        options.limit ?? 30,
        options.untilId ?? null,
      ),
    )
  }

  async getFollowers(
    userId: string,
    options: { limit?: number; untilId?: string } = {},
  ): Promise<FollowRelation[]> {
    return unwrapAny(
      await commands.apiGetFollowers(
        this.accountId,
        userId,
        options.limit ?? 30,
        options.untilId ?? null,
      ),
    )
  }

  async getUserRelations(userIds: string[]): Promise<UserRelation[]> {
    return unwrapAny(
      await commands.apiGetUserRelations(this.accountId, userIds),
    )
  }
}
