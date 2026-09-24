import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { getApiAdapter, resolveAccountId } from '../accountContext'
import { implement, implementCore } from '../declare'

/**
 * Clips (Misskey クリップ) 系 capability。
 *
 * AI 経路で塞がっていた「この note を ○○ クリップに入れて」「過去のクリップを
 * 整理して」を開放する (memory: feedback_ai_capability_scope のユーザー操作系)。
 * クリップは公開する場合もあるが基本的にユーザー私的な note 整理機能なので、
 * `notes.write` より弱い `clips.write` 権限で独立管理。
 *
 * 設計判断:
 * - update / delete 用 Rust コマンドはまだ存在しないので本 PR では追加せず、
 *   list / notes / create / addNote / removeNote の 5 つだけ提供
 * - 書込は adapter API 経由 (`addNoteToClip` / `removeNoteFromClip` /
 *   既存コマンド `apiCreateClip`)
 * - notes (= クリップ内のノート) は `notes.read` も併せて要求 (= 中身は note)
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

export const clipsListCapability = implementCore('clips.list')

export const clipsNotesCapability = implementCore('clips.notes')

export const clipsCreateCapability = implement('clips.create', {
  execute: async (params, ctx) => {
    const name = pickString(params?.name)
    if (!name) throw new Error('clips.create: name is required')
    const resolvedId = resolveAccountId(params?.accountId, ctx)
    const description = pickString(params?.description)
    const isPublic = params?.isPublic === true
    const clip = unwrap(
      await commands.apiCreateClip(resolvedId, {
        name,
        description: description ?? null,
        isPublic,
      }),
    )
    return {
      id: clip.id,
      name: clip.name,
      isPublic: clip.isPublic,
      description: clip.description,
    }
  },
})

export const clipsAddNoteCapability = implement('clips.addNote', {
  execute: async (params, ctx) => {
    const clipId = pickString(params?.clipId)
    const noteId = pickString(params?.noteId)
    if (!clipId) throw new Error('clips.addNote: clipId is required')
    if (!noteId) throw new Error('clips.addNote: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.addNoteToClip(clipId, noteId)
    return { ok: true, clipId, noteId }
  },
})

export const clipsRemoveNoteCapability = implement('clips.removeNote', {
  execute: async (params, ctx) => {
    const clipId = pickString(params?.clipId)
    const noteId = pickString(params?.noteId)
    if (!clipId) throw new Error('clips.removeNote: clipId is required')
    if (!noteId) throw new Error('clips.removeNote: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.removeNoteFromClip(clipId, noteId)
    return { ok: true, clipId, noteId }
  },
})

export const CLIPS_BUILTIN_CAPABILITIES: readonly Command[] = [
  clipsListCapability,
  clipsNotesCapability,
  clipsCreateCapability,
  clipsAddNoteCapability,
  clipsRemoveNoteCapability,
]
