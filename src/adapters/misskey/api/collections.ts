import type { JsonValue } from '@/bindings'
import { commands } from '@/utils/tauriInvoke'
import type {
  Antenna,
  Channel,
  Clip,
  CollectionsApi,
  NormalizedNote,
  PaginationOptions,
  UserList,
} from '../../types'
import { type MisskeyApiContext, unwrapAny } from './context'

export function createCollectionsApi(ctx: MisskeyApiContext): CollectionsApi {
  return {
    async getUserLists(): Promise<UserList[]> {
      return unwrapAny(await commands.apiGetUserLists(ctx.accountId))
    },

    async addUserToList(listId: string, userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiAddUserToList(ctx.accountId, listId, userId))
    },

    async removeUserFromList(listId: string, userId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiRemoveUserFromList(ctx.accountId, listId, userId),
      )
    },

    async getAntennas(): Promise<Antenna[]> {
      return unwrapAny(await commands.apiGetAntennas(ctx.accountId))
    },

    async getAntenna(antennaId: string): Promise<Antenna> {
      ctx.requireAuth()
      return unwrapAny(await commands.apiGetAntenna(ctx.accountId, antennaId))
    },

    async updateAntenna(antenna: Antenna): Promise<Antenna> {
      ctx.requireAuth()
      return unwrapAny(await commands.apiUpdateAntenna(ctx.accountId, antenna))
    },

    async getAntennaNotes(
      antennaId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetAntennaNotes(
          ctx.accountId,
          antennaId,
          options.limit ?? 20,
          options.sinceId ?? null,
          options.untilId ?? null,
        ),
      )
    },

    async getClips(): Promise<Clip[]> {
      return unwrapAny(await commands.apiGetClips(ctx.accountId))
    },

    async getClipNotes(
      clipId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetClipNotes(
          ctx.accountId,
          clipId,
          options.limit ?? 20,
          options.sinceId ?? null,
          options.untilId ?? null,
        ),
      )
    },

    async addNoteToClip(clipId: string, noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiAddNoteToClip(ctx.accountId, clipId, noteId))
    },

    async removeNoteFromClip(clipId: string, noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiRemoveNoteFromClip(ctx.accountId, clipId, noteId),
      )
    },

    async getChannels(): Promise<Channel[]> {
      return unwrapAny(await commands.apiGetChannels(ctx.accountId))
    },

    async getChannelNotes(
      channelId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetChannelNotes(
          ctx.accountId,
          channelId,
          options.limit ?? 20,
          options.sinceId ?? null,
          options.untilId ?? null,
        ),
      )
    },

    async getClip(clipId: string): Promise<Clip> {
      return unwrapAny(await commands.apiGetClip(ctx.accountId, { clipId }))
    },

    async createClip(name: string): Promise<Clip> {
      ctx.requireAuth()
      return unwrapAny(await commands.apiCreateClip(ctx.accountId, { name }))
    },

    async favoriteClip(clipId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiFavoriteClip(ctx.accountId, { clipId }))
    },

    async unfavoriteClip(clipId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnfavoriteClip(ctx.accountId, { clipId }))
    },

    async getUserClips(
      userId: string,
      options: PaginationOptions = {},
    ): Promise<Clip[]> {
      const params: Record<string, JsonValue> = { userId }
      if (options.limit != null) params.limit = options.limit
      if (options.sinceId) params.sinceId = options.sinceId
      if (options.untilId) params.untilId = options.untilId
      return unwrapAny(await commands.apiGetUserClips(ctx.accountId, params))
    },

    async getList(
      listId: string,
      options: { forPublic?: boolean } = {},
    ): Promise<UserList> {
      const params: Record<string, JsonValue> = { listId }
      if (options.forPublic) params.forPublic = true
      return unwrapAny(await commands.apiGetList(ctx.accountId, params))
    },

    async favoriteList(listId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiFavoriteList(ctx.accountId, { listId }))
    },

    async unfavoriteList(listId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnfavoriteList(ctx.accountId, { listId }))
    },

    async getUserListsBy(userId?: string): Promise<UserList[]> {
      const params: Record<string, JsonValue> = {}
      if (userId) params.userId = userId
      return unwrapAny(await commands.apiGetUserListsBy(ctx.accountId, params))
    },
  }
}
