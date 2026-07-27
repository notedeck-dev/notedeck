import type { JsonValue } from '@/bindings'
import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { ACCOUNT_ID_PARAM_DESC, resolveAccountId } from '../accountContext'

/**
 * Registry (Misskey サーバー側 KV ストア) 系 capability。
 * Misskey 公式 Web Client は theme / plugins / accountColor 等のユーザー設定を
 * registry に保存する。ここを AI から触ると **Misskey 公式 UI と挙動が共有
 * される** (= NoteDeck だけでなく公式 client にも反映される) ことに注意。
 *
 * scope は `string[]` で path components (例: `['client']` / `['client', 'misskey']`)。
 * 公式 UI が使うトップレベル scope 名は固定 (`['client']`)。
 *
 * permission: `account.read` (listKeys / get) / `account.write` (set / delete)。
 * 既存 account 系 perm を再利用 (= サーバー側設定の延長としての account 操作)。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function pickScope(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('registry: scope must be a string array (e.g. ["client"])')
  }
  const out: string[] = []
  for (const s of input) {
    if (typeof s !== 'string' || s.length === 0) {
      throw new Error('registry: scope entries must be non-empty strings')
    }
    out.push(s)
  }
  return out
}

const SCOPE_PARAM_DESC =
  'registry の scope 配列 (= path components)。例: `["client"]` / ' +
  '`["client","misskey"]`。Misskey 公式 UI と共有される設定エリア。'

export const registryListKeysCapability: Command = {
  id: 'registry.listKeys',
  label: 'registry の key 一覧',
  icon: 'ti-database',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '指定 scope 配下の key 一覧と各 key の型を返す (Misskey ' +
      '`i/registry/keys-with-type` 相当)。',
    params: {
      scope: {
        type: 'array',
        description: SCOPE_PARAM_DESC,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ [key]: typeString }',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const accountId = resolveAccountId(params?.accountId, ctx)
    return unwrap(await commands.apiListRegistryKeys(accountId, scope))
  },
}

export const registryGetCapability: Command = {
  id: 'registry.get',
  label: 'registry の値を取得',
  icon: 'ti-database',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '指定 scope の key の値を取得する (Misskey `i/registry/get-detail`)。' +
      ' 存在しない key は null を返す。',
    params: {
      scope: { type: 'array', description: SCOPE_PARAM_DESC },
      key: { type: 'string', description: '取得する key' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '取得した JsonValue (型は scope/key 依存)',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const key = pickString(params?.key)
    if (!key) throw new Error('registry.get: key is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    return unwrap(await commands.apiGetRegistryValue(accountId, scope, key))
  },
}

export const registrySetCapability: Command = {
  id: 'registry.set',
  label: 'registry に値を書込',
  icon: 'ti-database-edit',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: (params) => {
    const scope = Array.isArray(params?.scope)
      ? (params.scope as string[]).join('/')
      : '?'
    const key = typeof params?.key === 'string' ? params.key : '?'
    return {
      title: 'registry に書込',
      message:
        `Misskey サーバー側 registry の \`${scope}/${key}\` に値を書込みます。` +
        ' **Misskey 公式 Web Client と共有される設定エリア** なので、' +
        '公式 UI の挙動 (テーマ / 設定等) にも影響する可能性があります。',
      code: JSON.stringify(params?.value ?? null, null, 2),
      codeLanguage: 'json',
      okLabel: '書込',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      '指定 scope の key に JsonValue を書込む (Misskey `i/registry/set`)。' +
      ' Misskey 公式 Web Client と共有される設定エリアなので、変更は公式 UI ' +
      'にも反映される。',
    params: {
      scope: { type: 'array', description: SCOPE_PARAM_DESC },
      key: { type: 'string', description: '書込先 key' },
      value: {
        type: 'object',
        description:
          '書込む JsonValue (number / string / array / object / null 何でも可)',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'object', description: '{ ok: true, scope, key }' },
  },
  visible: false,
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const key = pickString(params?.key)
    if (!key) throw new Error('registry.set: key is required')
    if (params?.value === undefined) {
      throw new Error('registry.set: value is required (null も可、未指定不可)')
    }
    const accountId = resolveAccountId(params?.accountId, ctx)
    unwrap(
      await commands.apiSetRegistryValue(
        accountId,
        scope,
        key,
        params.value as JsonValue,
      ),
    )
    return { ok: true, scope, key }
  },
}

export const registryDeleteCapability: Command = {
  id: 'registry.delete',
  label: 'registry の値を削除',
  icon: 'ti-database-x',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: (params) => {
    const scope = Array.isArray(params?.scope)
      ? (params.scope as string[]).join('/')
      : '?'
    const key = typeof params?.key === 'string' ? params.key : '?'
    return {
      title: 'registry の値を削除',
      message:
        `Misskey サーバー側 registry の \`${scope}/${key}\` を削除します。` +
        ' **Misskey 公式 Web Client と共有される設定エリア** なので、' +
        '公式 UI でも該当設定が初期化されます。',
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  signature: {
    description:
      '指定 scope の key を削除する (Misskey `i/registry/remove`)。' +
      ' Misskey 公式 Web Client と共有される設定エリア。',
    params: {
      scope: { type: 'array', description: SCOPE_PARAM_DESC },
      key: { type: 'string', description: '削除する key' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'object', description: '{ deleted: true, scope, key }' },
  },
  visible: false,
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const key = pickString(params?.key)
    if (!key) throw new Error('registry.delete: key is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    unwrap(await commands.apiDeleteRegistryValue(accountId, scope, key))
    return { deleted: true, scope, key }
  },
}

export const REGISTRY_BUILTIN_CAPABILITIES: readonly Command[] = [
  registryListKeysCapability,
  registryGetCapability,
  registrySetCapability,
  registryDeleteCapability,
]
