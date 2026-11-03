import type { ApiTokenMeta, CreatedApiToken, JsonValue } from '@/bindings'
import type { PermissionsConfig } from '@/permissions/schema'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** 内蔵 HTTP API サーバー (#940) のトークンと OpenAPI 定義 (#1258) */
export function listApiTokens(): Promise<ApiTokenMeta[]> {
  return commands.listApiTokens()
}

/**
 * 本体のトークンはこの戻りでしか見られない (保存されるのはハッシュ)。
 * `scope` はトークン単位の権限 (#1292、外部アプリの権限との交差が実効権限)
 */
export function createApiToken(
  name: string,
  scope: PermissionsConfig,
): Promise<CreatedApiToken> {
  return commands
    .createApiToken(name, scope as unknown as JsonValue)
    .then(unwrap)
}

export function revokeApiToken(id: string): Promise<boolean> {
  return commands.revokeApiToken(id).then(unwrap)
}

export function openapiSpec(): Promise<unknown> {
  return commands.getOpenapiSpec().then(unwrap)
}
