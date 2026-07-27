import type { Command } from '@/commands/registry'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

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

export const listListCapability: Command = {
  id: 'list.list',
  label: '自分のリスト一覧',
  icon: 'ti-list',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '自分のユーザーリスト一覧を返す。各要素は { id, name, userIds, createdAt }。' +
      ' リスト編集 (list.addUser / removeUser) で listId を渡すときの起点。',
    params: {
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'UserList の配列',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getUserLists()
  },
}

export const listAddUserCapability: Command = {
  id: 'list.addUser',
  label: 'リストにユーザーを追加',
  icon: 'ti-user-plus',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '指定リストに指定 user を追加する。listId は list.list、userId は ' +
      'user.lookup / search で取得。相手に通知は飛ばない (= 自分の整理用)。',
    params: {
      listId: { type: 'string', description: '対象 listId' },
      userId: { type: 'string', description: '追加する userId' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ added: true, listId, userId }',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const listId = pickString(params?.listId)
    const userId = pickString(params?.userId)
    if (!listId) throw new Error('list.addUser: listId is required')
    if (!userId) throw new Error('list.addUser: userId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.addUserToList(listId, userId)
    return { added: true, listId, userId }
  },
}

export const listRemoveUserCapability: Command = {
  id: 'list.removeUser',
  label: 'リストからユーザーを削除',
  icon: 'ti-user-minus',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '指定リストから指定 user を削除する (= 自分の整理用、相手通知なし)。',
    params: {
      listId: { type: 'string', description: '対象 listId' },
      userId: { type: 'string', description: '削除する userId' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ removed: true, listId, userId }',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const listId = pickString(params?.listId)
    const userId = pickString(params?.userId)
    if (!listId) throw new Error('list.removeUser: listId is required')
    if (!userId) throw new Error('list.removeUser: userId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.removeUserFromList(listId, userId)
    return { removed: true, listId, userId }
  },
}

export const LIST_BUILTIN_CAPABILITIES: readonly Command[] = [
  listListCapability,
  listAddUserCapability,
  listRemoveUserCapability,
]
