import type { Muting } from '@/bindings'
import { type MutedUser, parseMutingExpiry } from '@/services/muteExpiry'
import { commands } from '@/utils/tauriInvoke'
import type {
  FollowRelation,
  MutedWordsResult,
  NormalizedNote,
  NormalizedUser,
  NormalizedUserDetail,
  NotesApi,
  PaginationOptions,
  UserNotesOptions,
  UserRelation,
  UsersApi,
} from '../../types'
import { type MisskeyApiContext, unwrapAny } from './context'

/**
 * `notes` は getUserNotes / getUserFeaturedNotes が ID → 正規化ノートの
 * 解決に使う (旧 this.getNote 相当の cross-domain 依存)。
 */
export function createUsersApi(
  ctx: MisskeyApiContext,
  notes: Pick<NotesApi, 'getNote'>,
): UsersApi {
  async function getUserNotes(
    userId: string,
    options: UserNotesOptions = {},
  ): Promise<NormalizedNote[]> {
    const { withReplies, withFiles, withChannelNotes, ...pagination } = options
    const hasFilters =
      withReplies != null || withFiles != null || withChannelNotes != null

    if (hasFilters && ctx.hasToken) {
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
        await commands.apiGetUserNotesFiltered(ctx.accountId, params as never),
      )
      if (!raw.length) return []
      return Promise.all(raw.map((n) => notes.getNote(n.id)))
    }

    return unwrapAny(
      await commands.apiGetUserNotes(ctx.accountId, userId, {
        limit: pagination.limit ?? 20,
        sinceId: pagination.sinceId ?? null,
        untilId: pagination.untilId ?? null,
        filters: null,
      } as never),
    )
  }

  async function getUserFeaturedNotes(
    userId: string,
    options: PaginationOptions = {},
  ): Promise<NormalizedNote[]> {
    try {
      const raw: { id: string }[] = unwrapAny(
        await commands.apiGetUserFeaturedNotes(
          ctx.accountId,
          userId,
          options.limit ?? 30,
          options.untilId ?? null,
        ),
      )
      if (!raw.length) return []
      return Promise.all(raw.map((n) => notes.getNote(n.id)))
    } catch {
      return getUserNotes(userId, { limit: options.limit ?? 20 })
    }
  }

  return {
    getUserNotes,
    getUserFeaturedNotes,

    async getUser(userId: string): Promise<NormalizedUser> {
      return unwrapAny(await commands.apiGetUser(ctx.accountId, userId))
    },

    async getUserDetail(userId: string): Promise<NormalizedUserDetail> {
      return unwrapAny(await commands.apiGetUserDetail(ctx.accountId, userId))
    },

    async lookupUser(
      username: string,
      host?: string | null,
    ): Promise<NormalizedUser> {
      return unwrapAny(
        await commands.apiLookupUser(ctx.accountId, username, host ?? null),
      )
    },

    async followUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiFollowUser(ctx.accountId, userId))
    },

    async unfollowUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnfollowUser(ctx.accountId, userId))
    },

    async invalidateFollower(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiInvalidateFollower(ctx.accountId, userId))
    },

    async updateFollowing(
      userId: string,
      options: { notify?: 'normal' | 'none'; withReplies?: boolean },
    ): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiUpdateFollowing(
          ctx.accountId,
          userId,
          options.notify ?? null,
          options.withReplies ?? null,
        ),
      )
    },

    async updateUserMemo(userId: string, memo: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUpdateUserMemo(ctx.accountId, userId, memo))
    },

    async acceptFollowRequest(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiAcceptFollowRequest(ctx.accountId, userId))
    },

    async rejectFollowRequest(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiRejectFollowRequest(ctx.accountId, userId))
    },

    async cancelFollowRequest(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiCancelFollowRequest(ctx.accountId, userId))
    },

    async getFollowing(
      userId: string,
      options: { limit?: number; untilId?: string } = {},
    ): Promise<FollowRelation[]> {
      return unwrapAny(
        await commands.apiGetFollowing(
          ctx.accountId,
          userId,
          options.limit ?? 30,
          options.untilId ?? null,
        ),
      )
    },

    async getFollowers(
      userId: string,
      options: { limit?: number; untilId?: string } = {},
    ): Promise<FollowRelation[]> {
      return unwrapAny(
        await commands.apiGetFollowers(
          ctx.accountId,
          userId,
          options.limit ?? 30,
          options.untilId ?? null,
        ),
      )
    },

    async getUserRelations(userIds: string[]): Promise<UserRelation[]> {
      return unwrapAny(
        await commands.apiGetUserRelations(ctx.accountId, userIds),
      )
    },

    async muteUser(userId: string, expiresAt?: number): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiMuteUser(ctx.accountId, userId, expiresAt ?? null),
      )
    },

    async unmuteUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnmuteUser(ctx.accountId, userId))
    },

    async getMutedUsers(): Promise<MutedUser[]> {
      ctx.requireAuth()
      const mutings = unwrapAny(await commands.apiGetMutedUsers(ctx.accountId))
      return mutings.map((m: Muting) => ({
        userId: m.muteeId,
        expiresAt: parseMutingExpiry(m.expiresAt),
      }))
    },

    async getMutedWords(): Promise<MutedWordsResult> {
      ctx.requireAuth()
      return unwrapAny(await commands.apiGetMutedWords(ctx.accountId))
    },

    async getRenoteMutedUsers(): Promise<string[]> {
      ctx.requireAuth()
      return unwrapAny(await commands.apiGetRenoteMutedUsers(ctx.accountId))
    },

    async renoteMuteUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiRenoteMuteUser(ctx.accountId, userId))
    },

    async unrenoteMuteUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnrenoteMuteUser(ctx.accountId, userId))
    },

    async blockUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiBlockUser(ctx.accountId, userId))
    },

    async unblockUser(userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnblockUser(ctx.accountId, userId))
    },

    async reportUser(userId: string, comment: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiReportUser(ctx.accountId, userId, comment))
    },
  }
}
