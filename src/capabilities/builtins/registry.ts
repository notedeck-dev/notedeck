import type { JsonValue } from '@/bindings'
import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { resolveAccountId } from '../accountContext'
import { implement } from '../declare'

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

export const registryListKeysCapability = implement('registry.listKeys', {
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const accountId = resolveAccountId(params?.accountId, ctx)
    return unwrap(await commands.apiListRegistryKeys(accountId, scope))
  },
})

export const registryGetCapability = implement('registry.get', {
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const key = pickString(params?.key)
    if (!key) throw new Error('registry.get: key is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    return unwrap(await commands.apiGetRegistryValue(accountId, scope, key))
  },
})

export const registrySetCapability = implement('registry.set', {
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
})

export const registryDeleteCapability = implement('registry.delete', {
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
  execute: async (params, ctx) => {
    const scope = pickScope(params?.scope)
    const key = pickString(params?.key)
    if (!key) throw new Error('registry.delete: key is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    unwrap(await commands.apiDeleteRegistryValue(accountId, scope, key))
    return { deleted: true, scope, key }
  },
})

export const REGISTRY_BUILTIN_CAPABILITIES: readonly Command[] = [
  registryListKeysCapability,
  registryGetCapability,
  registrySetCapability,
  registryDeleteCapability,
]
