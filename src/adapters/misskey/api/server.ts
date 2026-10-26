import type { JsonValue } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type {
  Announcement,
  FederationInstance,
  FederationInstancesParams,
  Flash,
  FlashesEndpoint,
  GalleryPost,
  Page,
  PagesEndpoint,
  PaginationOptions,
  ServerContentApi,
  ServerEmoji,
} from '../../types'
import { type MisskeyApiContext, unwrapAny } from './context'

export function createServerContentApi(
  ctx: MisskeyApiContext,
): ServerContentApi {
  return {
    async getServerEmojis(options = {}): Promise<ServerEmoji[]> {
      return unwrapAny(
        await commands.apiGetServerEmojis(
          ctx.accountId,
          options.refresh ?? false,
        ),
      )
    },

    async getPinnedReactions(): Promise<string[]> {
      return unwrapAny(await commands.apiGetPinnedReactions(ctx.accountId))
    },

    async getAnnouncements(
      options: { limit?: number; isActive?: boolean } = {},
    ): Promise<Announcement[]> {
      return unwrapAny(
        await commands.apiGetAnnouncements(
          ctx.accountId,
          options.limit ?? null,
          options.isActive ?? null,
        ),
      )
    },

    async getPages(endpoint: PagesEndpoint, limit?: number): Promise<Page[]> {
      return unwrap(
        await commands.apiGetPages(ctx.accountId, endpoint, limit ?? null),
      )
    },

    async getPage(pageId: string): Promise<unknown> {
      return unwrap(await commands.apiGetPage(ctx.accountId, pageId))
    },

    async getGalleryPosts(
      options: { limit?: number; untilId?: string } = {},
    ): Promise<GalleryPost[]> {
      return unwrap(
        await commands.apiGetGalleryPosts(
          ctx.accountId,
          options.limit ?? null,
          options.untilId ?? null,
        ),
      )
    },

    async getFlashes(
      endpoint: FlashesEndpoint,
      limit?: number,
    ): Promise<Flash[]> {
      return unwrapAny(
        await commands.apiGetFlashes(ctx.accountId, endpoint, limit ?? null),
      )
    },

    async getFlash(flashId: string): Promise<unknown> {
      return unwrap(await commands.apiGetFlash(ctx.accountId, flashId))
    },

    async getFederationInstances(
      params: FederationInstancesParams = {},
    ): Promise<FederationInstance[]> {
      return unwrap(
        await commands.apiGetFederationInstances(ctx.accountId, {
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
    },

    async getFederationInstance(host: string): Promise<FederationInstance> {
      return unwrap(
        await commands.apiGetFederationInstance(ctx.accountId, { host }),
      )
    },

    async getMetaDetail(): Promise<unknown> {
      return unwrap(await commands.apiGetMetaDetail(ctx.accountId))
    },

    async getServerStats(): Promise<unknown> {
      return unwrap(await commands.apiGetServerStats(ctx.accountId))
    },

    async readAnnouncement(announcementId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiReadAnnouncement(ctx.accountId, announcementId))
    },

    async likePage(pageId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiLikePage(ctx.accountId, pageId))
    },

    async unlikePage(pageId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiUnlikePage(ctx.accountId, pageId))
    },

    async updatePage(params: JsonValue): Promise<unknown> {
      ctx.requireAuth()
      return unwrap(await commands.apiUpdatePage(ctx.accountId, params))
    },

    async likeFlash(flashId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiLikeFlash(ctx.accountId, flashId))
    },

    async unlikeFlash(flashId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiUnlikeFlash(ctx.accountId, flashId))
    },

    async updateFlash(params: JsonValue): Promise<unknown> {
      ctx.requireAuth()
      return unwrap(await commands.apiUpdateFlash(ctx.accountId, params))
    },

    async likeGalleryPost(postId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiLikeGalleryPost(ctx.accountId, postId))
    },

    async unlikeGalleryPost(postId: string): Promise<void> {
      ctx.requireAuth()
      unwrap(await commands.apiUnlikeGalleryPost(ctx.accountId, postId))
    },

    async getUserPagesBy(
      userId: string,
      options: PaginationOptions = {},
    ): Promise<Page[]> {
      return unwrap(
        await commands.apiGetUserPagesBy(
          ctx.accountId,
          userPagination(userId, options),
        ),
      )
    },

    async getUserFlashs(
      userId: string,
      options: PaginationOptions = {},
    ): Promise<Flash[]> {
      return unwrapAny(
        await commands.apiGetUserFlashs(
          ctx.accountId,
          userPagination(userId, options),
        ),
      )
    },

    async getUserGalleryBy(
      userId: string,
      options: PaginationOptions = {},
    ): Promise<GalleryPost[]> {
      return unwrap(
        await commands.apiGetUserGalleryBy(
          ctx.accountId,
          userPagination(userId, options),
        ),
      )
    },

    async apShow(uri: string): Promise<unknown> {
      return unwrap(await commands.apiApShow(ctx.accountId, uri))
    },

    async request(
      endpoint: string,
      params: JsonValue | null,
    ): Promise<unknown> {
      return unwrap(await commands.apiRequest(ctx.accountId, endpoint, params))
    },
  }
}

/** users/pages, users/flashs, users/gallery/posts に共通の引数 */
function userPagination(
  userId: string,
  options: PaginationOptions,
): Record<string, JsonValue> {
  const params: Record<string, JsonValue> = { userId }
  if (options.limit != null) params.limit = options.limit
  if (options.sinceId) params.sinceId = options.sinceId
  if (options.untilId) params.untilId = options.untilId
  return params
}
