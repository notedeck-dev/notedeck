import type { Command } from '@/commands/registry'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

/**
 * Gallery (Misskey Gallery) 系 capability。Misskey の写真ギャラリー機能。
 *
 * read-only のみ提供。like / unlike は副作用ありで本 PR では除外する。
 * permission: `account.read`。AI から最近の gallery 投稿を引用 / 要約できる。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

export const galleryListCapability: Command = {
  id: 'gallery.list',
  label: 'Gallery 一覧',
  icon: 'ti-photo',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      'Misskey Gallery 投稿一覧を返す (read-only)。' +
      ' title / description / files / userId を含む。',
    params: {
      limit: {
        type: 'number',
        description: '取得件数 (default 20, 1-100)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description: 'untilId (古い方向のページング)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'array', description: 'GalleryPost の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const limit = pickNumber(params?.limit)
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getGalleryPosts({ limit, untilId })
  },
}

export const GALLERY_BUILTIN_CAPABILITIES: readonly Command[] = [
  galleryListCapability,
]
