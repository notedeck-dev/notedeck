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
  }
}
