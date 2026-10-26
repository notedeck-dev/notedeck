import type { ApiTokenMeta, CreatedApiToken } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** 内蔵 HTTP API サーバー (#940) のトークンと OpenAPI 定義 (#1258) */
export function listApiTokens(): Promise<ApiTokenMeta[]> {
  return commands.listApiTokens()
}

/** 本体のトークンはこの戻りでしか見られない (保存されるのはハッシュ) */
export function createApiToken(name: string): Promise<CreatedApiToken> {
  return commands.createApiToken(name).then(unwrap)
}

export function revokeApiToken(id: string): Promise<boolean> {
  return commands.revokeApiToken(id).then(unwrap)
}

export function openapiSpec(): Promise<unknown> {
  return commands.getOpenapiSpec().then(unwrap)
}
