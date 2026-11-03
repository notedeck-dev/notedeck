/**
 * この端末の中で動くサービス (ローカル接続、#880) の判定。
 *
 * Rust 側 (`ssrf::normalize_loopback_url`) と同じ規則で、loopback と見るのは
 * `localhost` / `127.0.0.1` / `[::1]` の 3 表記だけ。保存時に Rust が両向きに検査する
 * (loopback の URL ⇔ ローカル接続) ので、ここは UI の出し分けと入力の先回りの誤り表示用。
 */

import type { ConnectionProtocol } from '@/bindings'

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** URL の host が loopback の 3 表記か。パースできない文字列は false。 */
export function isLoopbackUrl(raw: string): boolean {
  const u = parse(raw)
  return u != null && LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase())
}

/** loopback の URL なのにポートが無い (Rust は保存を拒むので、先に知らせる)。 */
export function isLoopbackUrlMissingPort(raw: string): boolean {
  const u = parse(raw)
  return (
    u != null &&
    LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase()) &&
    u.port === ''
  )
}

/**
 * protocol ごとのモデル一覧のパス (baseUrl の下)。Rust の `models_path_for` と同じ。
 * OpenAI 互換の baseUrl は `/v1` を含むので `/models`、Anthropic 互換は含まないので
 * `/v1/models`。
 */
export function modelsPathFor(protocol: ConnectionProtocol | null): string {
  switch (protocol) {
    case 'openai-compat':
      return '/models'
    case 'anthropic':
      return '/v1/models'
    default:
      return '/'
  }
}
