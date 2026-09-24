import type { Command } from '@/commands/registry'
import { getApiAdapter } from '../accountContext'
import { implement, implementCore } from '../declare'

/**
 * List (Misskey users/lists) 系 capability。自分のリスト編成を AI から
 * 整理できる。「○○ さんを A リストに入れて」が会話で完結する。
 *
 * リスト自体の create / update / delete は対応する Rust コマンド / adapter
 * メソッドが現状存在しないため本 PR では追加しない (= list.list + addUser +
 * removeUser の 3 つだけ提供)。
 *
 * permission: `account.read` (list) / `account.write` (addUser / removeUser)。
 * リスト編集 = 自分のフォロー整理の延長として account 系 perm に乗せる。
 * 相手に通知は飛ばないので慎重カテゴリではない。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

export const listListCapability = implementCore('list.list')

export const listAddUserCapability = implement('list.addUser', {
  execute: async (params, ctx) => {
    const listId = pickString(params?.listId)
    const userId = pickString(params?.userId)
    if (!listId) throw new Error('list.addUser: listId is required')
    if (!userId) throw new Error('list.addUser: userId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.addUserToList(listId, userId)
    return { added: true, listId, userId }
  },
})

export const listRemoveUserCapability = implement('list.removeUser', {
  execute: async (params, ctx) => {
    const listId = pickString(params?.listId)
    const userId = pickString(params?.userId)
    if (!listId) throw new Error('list.removeUser: listId is required')
    if (!userId) throw new Error('list.removeUser: userId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.removeUserFromList(listId, userId)
    return { removed: true, listId, userId }
  },
})

export const LIST_BUILTIN_CAPABILITIES: readonly Command[] = [
  listListCapability,
  listAddUserCapability,
  listRemoveUserCapability,
]
