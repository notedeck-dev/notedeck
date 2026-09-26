/**
 * この端末の構成 (client.json5) の codec (#1106 段階 3a)。
 *
 * `backend` は「アプリに埋め込んだ notecore を使う (embedded)」か「常駐の
 * notecored に中継する (resident)」か。`pending-resident` は切替の途中 (移行
 * パッケージを書き出し済みで、次の起動で import して常駐に切り替える)。
 * 手元側のファイルなので設定バックアップに含めず、書くのはアプリの切替導線だけ。
 * 無い / 壊れているときは embedded。Rust 側の codec と同じ規則。
 */

import JSON5 from 'json5'

export type ClientBackend = 'embedded' | 'pending-resident' | 'resident'

export interface ClientConfig {
  backend: ClientBackend
}

const BACKENDS: readonly ClientBackend[] = [
  'embedded',
  'pending-resident',
  'resident',
]

export const DEFAULT_CLIENT_CONFIG: ClientConfig = { backend: 'embedded' }

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
  return `// この端末の構成 (#1106)。embedded = アプリに埋め込んだ notecore、resident = 常駐の notecored に中継\n{\n  backend: '${cfg.backend}',\n}\n`
}
