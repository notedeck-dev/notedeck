import { isColumnType } from '@/columns/registry'
import type { Command } from '@/commands/registry'
import {
  type ColumnType,
  DEFAULT_NAV_ITEMS,
  isNavDivider,
  type NavItem,
  useDeckStore,
} from '@/stores/deck'
import { implement } from '../declare'

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
    // 手書きの許可リストではなくレジストリ照会 (#794 W2)。実行時登録された
    // プラグイン定義カラムもナビバーに置ける
    if (!isColumnType(obj.type)) {
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

export const navbarListCapability = implement('navbar.list', {
  execute: () => {
    const store = useDeckStore()
    return store.navItems.map((item) => {
      if (isNavDivider(item)) return { type: 'divider' as const }
      return {
        type: item.type,
        accountId: item.accountId,
        label: item.label ?? null,
      }
    })
  },
})

export const navbarSetCapability = implement('navbar.set', {
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
  execute: (params) => {
    const items = parseNavItems(params?.items)
    const store = useDeckStore()
    store.setNavItems(items)
    return { count: items.length }
  },
})

export const navbarResetCapability = implement('navbar.reset', {
  requiresConfirmation: () => ({
    title: 'ナビバー構成を default に戻す',
    message: `現在のカスタム構成を破棄し、デフォルトの ${DEFAULT_NAV_ITEMS.length} 項目に戻します。`,
    code: JSON.stringify(
      DEFAULT_NAV_ITEMS.map((i) =>
        isNavDivider(i)
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
  execute: () => {
    const store = useDeckStore()
    store.setNavItems(undefined)
    return { count: DEFAULT_NAV_ITEMS.length }
  },
})

export const NAVBAR_BUILTIN_CAPABILITIES: readonly Command[] = [
  navbarListCapability,
  navbarSetCapability,
  navbarResetCapability,
]
