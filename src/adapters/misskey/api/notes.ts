import { commands } from '@/utils/tauriInvoke'
import type {
  CreateNoteParams,
  NormalizedNote,
  NoteReaction,
  NotesApi,
  PaginationOptions,
  SearchOptions,
  TimelineOptions,
  TimelineType,
} from '../../types'
import { type MisskeyApiContext, unwrapAny } from './context'

export function createNotesApi(ctx: MisskeyApiContext): NotesApi {
  return {
    async getTimeline(
      type: TimelineType,
      options: TimelineOptions = {},
    ): Promise<NormalizedNote[]> {
      // OGP prefetch is handled asynchronously on the Rust side via Tauri events
      return unwrapAny(
        await commands.apiGetTimeline(ctx.accountId, type, {
          limit: options.limit ?? 20,
          sinceId: options.sinceId ?? null,
          untilId: options.untilId ?? null,
          filters: (options.filters ?? null) as never,
          listId: options.listId ?? null,
        }),
      )
    },

    async getNote(noteId: string): Promise<NormalizedNote> {
      return unwrapAny(await commands.apiGetNote(ctx.accountId, noteId))
    },

    async createNote(params: CreateNoteParams): Promise<NormalizedNote> {
      ctx.requireAuth()
      const { channelId, ...noteParams } = params
      return unwrapAny(
        await commands.apiCreateNote(
          ctx.accountId,
          noteParams as never,
          channelId ?? null,
        ),
      )
    },

    async updateNote(noteId: string, params: CreateNoteParams): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiUpdateNote(ctx.accountId, noteId, params as never),
      )
    },

    async deleteNote(noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiDeleteNote(ctx.accountId, noteId))
    },

    async createReaction(noteId: string, reaction: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(
        await commands.apiCreateReaction(ctx.accountId, noteId, reaction),
      )
    },

    async deleteReaction(noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiDeleteReaction(ctx.accountId, noteId))
    },

    async votePoll(noteId: string, choice: number): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiVotePoll(ctx.accountId, noteId, choice))
    },

    async getNoteReactions(
      noteId: string,
      reactionType?: string,
      limit?: number,
      untilId?: string,
    ): Promise<NoteReaction[]> {
      return unwrapAny(
        await commands.apiGetNoteReactions(
          ctx.accountId,
          noteId,
          reactionType ?? null,
          limit ?? null,
          untilId ?? null,
        ),
      )
    },

    async createFavorite(noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiCreateFavorite(ctx.accountId, noteId))
    },

    async deleteFavorite(noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiDeleteFavorite(ctx.accountId, noteId))
    },

    async pinNote(noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiPinNote(ctx.accountId, noteId))
    },

    async unpinNote(noteId: string): Promise<void> {
      ctx.requireAuth()
      unwrapAny(await commands.apiUnpinNote(ctx.accountId, noteId))
    },

    async searchNotes(
      query: string,
      options: SearchOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiSearchNotes(ctx.accountId, query, {
          limit: options.limit ?? 20,
          sinceId: options.sinceId ?? null,
          untilId: options.untilId ?? null,
          sinceDate: options.sinceDate ?? null,
          untilDate: options.untilDate ?? null,
          userId: options.userId ?? null,
          host: options.host ?? null,
        }),
      )
    },

    async getNoteChildren(
      noteId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetNoteChildren(
          ctx.accountId,
          noteId,
          options.limit ?? 30,
        ),
      )
    },

    async getNoteRenotes(
      noteId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetNoteRenotes(
          ctx.accountId,
          noteId,
          options.limit ?? 30,
        ),
      )
    },

    async getNoteConversation(
      noteId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetNoteConversation(
          ctx.accountId,
          noteId,
          options.limit ?? 30,
        ),
      )
    },

    async getMentions(
      options: PaginationOptions & { visibility?: string } = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetMentions(
          ctx.accountId,
          options.limit ?? 20,
          options.sinceId ?? null,
          options.untilId ?? null,
          options.visibility ?? null,
        ),
      )
    },

    async getFavorites(
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetFavorites(
          ctx.accountId,
          options.limit ?? 20,
          options.sinceId ?? null,
          options.untilId ?? null,
        ),
      )
    },

    async getFeaturedNotes(
      options: { limit?: number } = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetFeaturedNotes(ctx.accountId, options.limit ?? 30),
      )
    },

    async getRoleNotes(
      roleId: string,
      options: PaginationOptions = {},
    ): Promise<NormalizedNote[]> {
      return unwrapAny(
        await commands.apiGetRoleNotes(
          ctx.accountId,
          roleId,
          options.limit ?? 20,
          options.sinceId ?? null,
          options.untilId ?? null,
        ),
      )
    },
  }
}
