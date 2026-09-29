/**
 * この端末の構成 (client.json5) の codec (#1106 案 B)。
 *
 * `backend` は AI (notemaid) をどこで動かすか: auto (既定。常駐の notemaid が居れば
 * 繋ぎ、居なければ同梱の sidecar を子プロセスで起動、どちらも無ければ in-process) /
 * embedded (常に in-process) / resident (常駐にだけ繋ぐ)。データ面は構成に関わらず
 * 常にアプリの中。手元側のファイルなので設定バックアップに含めない。
 * 無い / 壊れているときは auto。Rust 側の codec と同じ規則。
 */

import JSON5 from 'json5'

export type ClientBackend = 'auto' | 'embedded' | 'resident'

export interface ClientConfig {
  backend: ClientBackend
}

const BACKENDS: readonly ClientBackend[] = ['auto', 'embedded', 'resident']

export const DEFAULT_CLIENT_CONFIG: ClientConfig = { backend: 'auto' }

export function parseClientConfig(raw: string): ClientConfig {
  if (raw.trim() === '') return { ...DEFAULT_CLIENT_CONFIG }
  try {
    const parsed = JSON5.parse(raw) as Partial<ClientConfig>
    const backend = parsed?.backend
    return BACKENDS.includes(backend as ClientBackend)
      ? { backend: backend as ClientBackend }
      : { ...DEFAULT_CLIENT_CONFIG }
  } catch {
    return { ...DEFAULT_CLIENT_CONFIG }
  }
}

export function serializeClientConfig(cfg: ClientConfig): string {
  return `// この端末の AI (notemaid) の動かし方 (#1106)。auto = 常駐が居れば繋ぎ、無ければ子プロセス / embedded = 常に in-process / resident = 常駐にだけ繋ぐ\n{\n  backend: '${cfg.backend}',\n}\n`
}
