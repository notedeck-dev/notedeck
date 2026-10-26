import { commands } from '@/utils/tauriInvoke'
import type { ChatApi, ChatMessage, PaginationOptions } from '../../types'
import { type MisskeyApiContext, unwrapAny } from './context'

export function createChatApi(ctx: MisskeyApiContext): ChatApi {
  return {
    async createChatMessage(params: {
      userId?: string | null
      roomId?: string | null
      text?: string | null
      fileId?: string | null
    }): Promise<ChatMessage> {
      ctx.requireAuth()
      return unwrapAny(
        await commands.apiCreateChatMessage(
          ctx.accountId,
          params.userId ?? null,
          params.roomId ?? null,
          params.text ?? null,
          params.fileId ?? null,
        ),
      )
    },

    async deleteChatMessage(messageId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiDeleteChatMessage(ctx.accountId, messageId))
    },

    async reactChatMessage(messageId: string, reaction: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiReactChatMessage(ctx.accountId, messageId, reaction),
      )
    },

    async unreactChatMessage(
      messageId: string,
      reaction: string,
    ): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiUnreactChatMessage(
          ctx.accountId,
          messageId,
          reaction,
        ),
      )
    },

    async getCachedChatHistory(limit?: number): Promise<ChatMessage[]> {
      return unwrapAny(
        await commands.apiGetCachedChatHistory(ctx.accountId, limit ?? null),
      )
    },

    async getCachedChatThreadMessages(
      threadId: string,
      options: { untilId?: string | null; limit?: number | null } = {},
    ): Promise<ChatMessage[]> {
      return unwrapAny(
        await commands.apiGetCachedChatThreadMessages(
          ctx.accountId,
          threadId,
          options.untilId ?? null,
          options.limit ?? null,
        ),
      )
    },

    async getChatHistory(
      limit?: number,
      cache?: boolean | null,
    ): Promise<ChatMessage[]> {
      return unwrapAny(
        await commands.apiGetChatHistory(
          ctx.accountId,
          limit ?? 100,
          null,
          cache ?? null,
        ),
      )
    },

    async getChatRoomHistory(
      limit?: number,
      cache?: boolean | null,
    ): Promise<ChatMessage[]> {
      return unwrapAny(
        await commands.apiGetChatHistory(
          ctx.accountId,
          limit ?? 100,
          true,
          cache ?? null,
        ),
      )
    },

    async getChatUserMessages(
      userId: string,
      options: PaginationOptions & { cache?: boolean | null } = {},
    ): Promise<ChatMessage[]> {
      return unwrapAny(
        await commands.apiGetChatUserMessages(
          ctx.accountId,
          userId,
          options.limit ?? 30,
          options.sinceId ?? null,
          options.untilId ?? null,
          options.cache ?? null,
        ),
      )
    },

    async getChatRoomMessages(
      roomId: string,
      options: PaginationOptions & { cache?: boolean | null } = {},
    ): Promise<ChatMessage[]> {
      return unwrapAny(
        await commands.apiGetChatRoomMessages(
          ctx.accountId,
          roomId,
          options.limit ?? 30,
          options.sinceId ?? null,
          options.untilId ?? null,
          options.cache ?? null,
        ),
      )
    },
  }
}
