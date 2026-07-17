import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * `misstore.search` — MisStore (store.notedeck.io) のレジストリ JSON を
 * GET して結果をフィルタする。AI がユーザーに「これあるよ」と推薦するため。
 *
 * 命名: ユーザー確定方針で `misstore.<verb>` (固有名 + 動詞)。
 *
 * 内部実装は HTTP fetch だが、エンドポイントが固定 (store.notedeck.io) なので
 * `requiresConfirmation` は false。任意の URL を叩く `http.fetch` とは違う
 * リスクプロファイル。
 */

const MISSTORE_BASE = 'https://store.notedeck.io'
const VALID_KINDS = ['plugin', 'widget', 'skill', 'theme'] as const
type Kind = (typeof VALID_KINDS)[number]

interface IndexItem {
  id: string
  name: string
  description?: string
  category?: string
  iconUrl?: string
}

export const misstoreSearchCapability: Command = {
  id: 'misstore.search',
  label: 'MisStore を検索',
  icon: 'ti-shopping-bag',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['network.external'],
  signature: {
    description:
      'MisStore (store.notedeck.io) のレジストリを検索する。' +
      ' query は name / description / id の部分一致 (大小無視)。' +
      ' kind 省略時は plugin / widget / skill / theme を全件横断検索。' +
      ' エンドポイントは固定なので確認ダイアログは出ない。',
    params: {
      query: { type: 'string', description: '検索クエリ (部分一致、大小無視)' },
      kind: {
        type: 'string',
        description: '検索する種別 (省略時は全種別)',
        enum: ['plugin', 'widget', 'skill', 'theme'],
        optional: true,
      },
      limit: {
        type: 'number',
        description: '最大返却数 (default: 20)',
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: '[{ id, name, description, category, kind, iconUrl? }]',
    },
  },
  visible: false,
  execute: async (params) => {
    const query = typeof params?.query === 'string' ? params.query : ''
    if (!query) throw new Error('misstore.search: query is required')
    const limit =
      typeof params?.limit === 'number' && params.limit > 0 ? params.limit : 20
    const kindParam =
      typeof params?.kind === 'string' ? (params.kind as Kind) : null
    const kinds: Kind[] =
      kindParam && (VALID_KINDS as readonly string[]).includes(kindParam)
        ? [kindParam]
        : [...VALID_KINDS]

    const needle = query.toLowerCase()
    const results: {
      id: string
      name: string
      description: string | null
      category: string | null
      kind: Kind
      iconUrl: string | null
    }[] = []

    for (const kind of kinds) {
      if (results.length >= limit) break
      // `<kind>s.json` (例: plugins.json) がレジストリのインデックス
      const url = `${MISSTORE_BASE}/registry/${kind}s.json`
      try {
        const response = unwrap(
          await commands.httpFetch({
            url,
            method: 'GET',
            headers: null,
            body: null,
            timeoutMs: 15000,
          }),
        )
        if (response.status < 200 || response.status >= 300) {
          console.warn(`[misstore.search] ${url} -> ${response.status}`)
          continue
        }
        const parsed = JSON.parse(response.body) as {
          [k: string]: IndexItem[]
        }
        const items = parsed[`${kind}s`] ?? []
        for (const item of items) {
          if (results.length >= limit) break
          const hay = [
            item.id,
            item.name,
            item.description ?? '',
            item.category ?? '',
          ]
            .join(' ')
            .toLowerCase()
          if (hay.includes(needle)) {
            results.push({
              id: item.id,
              name: item.name,
              description: item.description ?? null,
              category: item.category ?? null,
              kind,
              iconUrl: item.iconUrl ?? null,
            })
          }
        }
      } catch (e) {
        console.warn(`[misstore.search] failed to fetch ${url}:`, e)
      }
    }

    return results
  },
}

export const MISSTORE_BUILTIN_CAPABILITIES: readonly Command[] = [
  misstoreSearchCapability,
]
