/**
 * Secret Vault (#564) のフロントエンド store。
 *
 * `commands.vault*` の薄いラッパー。接続メタデータの reactive な一覧を保持し、
 * CRUD 操作後に再取得する。secret 値は決してこの層に乗らない
 * (Rust 側で OS キーチェーンに格納、注入も Rust 側)。
 */

import { computed, ref } from 'vue'
import type {
  AuthType,
  Connection,
  ConnectionUpsert,
  SecretStatus,
  VaultFetchRequest,
  VaultFetchResponse,
  VaultTestResult,
} from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

const connections = ref<Connection[]>([])
const loaded = ref(false)
const loading = ref(false)

/** 接続一覧を再取得する。 */
async function refresh(): Promise<void> {
  loading.value = true
  try {
    connections.value = unwrap(await commands.vaultListConnections())
    loaded.value = true
  } finally {
    loading.value = false
  }
}

/** 接続メタデータを作成 / 更新する (secret は触らない)。 */
async function upsertConnection(input: ConnectionUpsert): Promise<Connection> {
  const result = unwrap(await commands.vaultUpsertConnection(input))
  await refresh()
  return result
}

/** 接続メタデータと secret を 1 トランザクションで作成 / 更新する。 */
async function upsertConnectionWithSecret(
  input: ConnectionUpsert,
  slot: string,
  secret: string,
): Promise<Connection> {
  const result = unwrap(
    await commands.vaultUpsertConnectionWithSecret(input, slot, secret),
  )
  await refresh()
  return result
}

/** 既存接続の secret を設定 / 入れ替える。 */
async function setSecret(
  id: string,
  slot: string,
  secret: string,
): Promise<Connection> {
  const result = unwrap(await commands.vaultSetSecret(id, slot, secret))
  await refresh()
  return result
}

/** 接続の secret 設定状況を取得する。 */
async function getSecretStatus(id: string): Promise<SecretStatus> {
  return unwrap(await commands.vaultGetSecretStatus(id))
}

/** 接続の特定 slot の secret を削除する。 */
async function deleteSecret(id: string, slot: string): Promise<void> {
  unwrap(await commands.vaultDeleteSecret(id, slot))
  await refresh()
}

/** 接続を削除する (secret も keychain から消える)。 */
async function deleteConnection(id: string): Promise<void> {
  unwrap(await commands.vaultDeleteConnection(id))
  await refresh()
}

/** 接続を AI に開示するかを切り替える。 */
async function setAiVisible(id: string, visible: boolean): Promise<void> {
  unwrap(await commands.vaultSetAiVisible(id, visible))
  await refresh()
}

/** 接続の疎通テストを実行する。 */
async function testConnection(
  id: string,
  testPath: string | null,
): Promise<VaultTestResult> {
  return unwrap(await commands.vaultTestConnection(id, testPath))
}

/** 登録済み接続を使って HTTP リクエストを実行する。 */
async function fetch(
  id: string,
  request: VaultFetchRequest,
): Promise<VaultFetchResponse> {
  return unwrap(await commands.vaultFetch(id, request))
}

/** authType を人間が読める文字列に変換する。 */
export function describeAuthType(authType: AuthType): string {
  switch (authType.kind) {
    case 'bearer':
      return 'Authorization: Bearer'
    case 'header':
      return `ヘッダー: ${authType.name}`
    case 'query':
      return `クエリ: ?${authType.param}=`
    case 'basic':
      return `Basic 認証 (${authType.username})`
  }
}

export function useVault() {
  return {
    connections: computed(() => connections.value),
    loaded: computed(() => loaded.value),
    loading: computed(() => loading.value),
    refresh,
    upsertConnection,
    upsertConnectionWithSecret,
    setSecret,
    getSecretStatus,
    deleteSecret,
    deleteConnection,
    setAiVisible,
    testConnection,
    fetch,
  }
}
