import type { Command } from '@/commands/registry'
import {
  type ColumnType,
  DEFAULT_NAV_ITEMS,
  type NavItem,
  useDeckStore,
} from '@/stores/deck'

/**
 * Navbar 系 capability — 「自己拡張する IDE」(memory:
 * project_self_extending_ide_roadmap) の延長線。プロファイル切替の本丸として
 * 「集中モード用ナビバー作って」「アクティブな項目だけにして」が会話で
 * 完結する。
 *
 * 設計判断:
 * - navbar.json5 は単一配列構造なので set は全置換 (差分 patch ではない)
 * - reset は default に戻すユーティリティ (= ユーザー安心の出口)
 * - 各 NavItem の columnProps 詳細は触らず、type + accountId + label の
 *   基本構造のみ AI 操作対象。複雑な columnProps が必要なら手で UI から触る
 *   (= AI 用 API はシンプルに保つ)
 */

const VALID_COLUMN_TYPES: readonly ColumnType[] = [
  'timeline',
  'notifications',
  'search',
  'list',
  'antenna',
  'favorites',
  'clip',
  'user',
  'mentions',
  'channel',
  'role',
  'specified',
  'chat',
  'widget',
  'aiscript',
  'play',
  'page',
  'ai',
  'announcements',
  'drive',
  'gallery',
  'explore',
  'followRequests',
  'achievements',
  'apiConsole',
  'apiDocs',
  'lookup',
  'serverInfo',
  'ads',
  'aboutMisskey',
  'emoji',
  'streamInspector',
  'pluginManager',
  'themeManager',
  'taskRunner',
  'memos',
  'charts',
  'federation',
  'skill',
] as const

/** AI 入力 (JSON) を NavItem[] に変換しつつ最小限の sanity check。 */
function parseNavItems(input: unknown): NavItem[] {
  if (!Array.isArray(input)) {
    throw new Error('navbar.set: items must be an array')
  }
  const result: NavItem[] = []
  for (let i = 0; i < input.length; i++) {
    const raw = input[i]
    if (!raw || typeof raw !== 'object') {
      throw new Error(`navbar.set: item #${i} is not an object`)
    }
    const obj = raw as Record<string, unknown>
    if (obj.type === 'divider') {
      result.push({ type: 'divider' })
      continue
    }
    if (typeof obj.type !== 'string') {
      throw new Error(`navbar.set: item #${i} missing string "type"`)
    }
    if (!VALID_COLUMN_TYPES.includes(obj.type as ColumnType)) {
      throw new Error(`navbar.set: item #${i} has unknown type "${obj.type}"`)
    }
    const item: NavItem = {
      type: obj.type as ColumnType,
      accountId: typeof obj.accountId === 'string' ? obj.accountId : null,
    }
    if (typeof obj.label === 'string' && obj.label.length > 0) {
      item.label = obj.label
    }
    // columnProps は AI 側では触らせない (= 複雑な構造を AI に組ませない)
    result.push(item)
  }
  return result
}

export const navbarListCapability: Command = {
  id: 'navbar.list',
  label: 'ナビバー構成を読む',
  icon: 'ti-layout-sidebar',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在のナビバー構成 (navItems) を返す。各要素は ' +
      ' { type, accountId, label? } または { type: "divider" }。' +
      ' navbar.set で AI が新構成を提案するときの起点。',
    params: {},
    returns: {
      type: 'array',
      description: '現在の NavItem 配列',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useDeckStore()
    return store.navItems.map((item) => {
      if (item.type === 'divider') return { type: 'divider' as const }
      return {
        type: item.type,
        accountId: item.accountId,
        label: item.label ?? null,
      }
    })
  },
}

export const navbarSetCapability: Command = {
  id: 'navbar.set',
  label: 'ナビバー構成を上書き',
  icon: 'ti-layout-sidebar',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['navbar.write'],
  requiresConfirmation: (params) => {
    let count = 0
    if (Array.isArray(params?.items)) count = params.items.length
    return {
      title: 'ナビバー構成を上書き',
      message:
        `ナビバーを ${count} 項目で全置換します。` +
        ' 現在の構成は失われます (navbar.reset で default に戻せます)。',
      code: JSON.stringify(params?.items ?? [], null, 2),
      codeLanguage: 'json',
      okLabel: '上書き',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'ナビバー構成 (navItems) を全置換する。差分編集ではなく完全上書きなので、' +
      ' navbar.list で現状取得してから、追加/削除/並び替えを反映した完全配列を渡す。' +
      ' columnProps 等の詳細項目は AI 経由では触らない (= type / accountId / label のみ)。',
    params: {
      items: {
        type: 'array',
        description:
          '新しい NavItem 配列。各要素は { type: ColumnType | "divider", ' +
          'accountId: string | null, label?: string }。' +
          ' ColumnType は notifications / mentions / chat / search / lookup ' +
          '/ widget / ai / memos / emoji 等 (詳細は navbar.list の戻り値を参照)',
      },
    },
    returns: {
      type: 'object',
      description: '{ count: 書込後の項目数 }',
    },
  },
  visible: false,
  execute: (params) => {
    const items = parseNavItems(params?.items)
    const store = useDeckStore()
    store.setNavItems(items)
    return { count: items.length }
  },
}

export const navbarResetCapability: Command = {
  id: 'navbar.reset',
  label: 'ナビバー構成を default に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['navbar.write'],
  requiresConfirmation: () => ({
    title: 'ナビバー構成を default に戻す',
    message: `現在のカスタム構成を破棄し、デフォルトの ${DEFAULT_NAV_ITEMS.length} 項目に戻します。`,
    code: JSON.stringify(
      DEFAULT_NAV_ITEMS.map((i) =>
        i.type === 'divider'
          ? { type: 'divider' }
          : { type: i.type, accountId: i.accountId },
      ),
      null,
      2,
    ),
    codeLanguage: 'json',
    okLabel: 'default に戻す',
    cancelLabel: 'やめる',
    type: 'warning',
  }),
  signature: {
    description: 'ナビバー構成を NoteDeck の default に戻す。',
    params: {},
    returns: {
      type: 'object',
      description: '{ count: default 項目数 }',
    },
  },
  visible: false,
  execute: () => {
    const store = useDeckStore()
    store.setNavItems(undefined)
    return { count: DEFAULT_NAV_ITEMS.length }
  },
}

export const NAVBAR_BUILTIN_CAPABILITIES: readonly Command[] = [
  navbarListCapability,
  navbarSetCapability,
  navbarResetCapability,
]
