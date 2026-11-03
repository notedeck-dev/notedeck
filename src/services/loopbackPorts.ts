/**
 * プラグインの loopback 同意 (#1293) のポート規則。Rust (`crates/notecore/src/ssrf.rs`
 * の `is_always_denied_loopback_port` / `loopback_port`、`sidecar/plugin_meta.rs` の
 * `normalize_loopback_ports`) と同じ規則で、同じ golden
 * (`src/aiscript/golden/loopbackHeader.json`) を通す。許可は Rust が決める —
 * TS 側の判定は拒否と表示にしか使わない。
 */

/** Fetch 標準の "bad port" (ブラウザが繋がないポート)。Rust の `BAD_PORTS` と同じ */
const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
])

/** 自アプリが listen するポート (HTTP API の release / debug、Dev Dashboard) */
const SELF_PORTS = new Set([19820, 19821, 5173])

/** 同意があっても繋がない危険なローカルサービス (Docker API / CDP / Node inspector) */
const DANGEROUS_LOCAL_PORTS = new Set([2375, 2376, 9222, 9229])

/** プラグインの loopback 宛の要求を拒んだ理由 (バッジ / トースト / 運用ログ) */
export type LoopbackDenialReason =
  | 'chain'
  | 'notEligible'
  | 'selfPort'
  | 'undeclared'
  | 'stale'
  | 'notGranted'

/** ヘッダーに宣言できるポートの個数の上限 (golden の `maxPorts`) */
export const MAX_LOOPBACK_PORTS = 8

export function isAlwaysDeniedLoopbackPort(port: number): boolean {
  return (
    SELF_PORTS.has(port) ||
    BAD_PORTS.has(port) ||
    DANGEROUS_LOCAL_PORTS.has(port)
  )
}

/**
 * ヘッダーの `loopback` の生の配列を正規化する: 整数で 1〜65535 のものだけ、重複は
 * 最初の出現、常に拒否するポートは捨て、上限で切る
 */
export function normalizeLoopbackPorts(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v)) continue
    if (v < 1 || v > 65535) continue
    if (isAlwaysDeniedLoopbackPort(v)) continue
    if (out.includes(v)) continue
    out.push(v)
    if (out.length >= MAX_LOOPBACK_PORTS) break
  }
  return out
}

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }

/**
 * URL の host が loopback の 3 表記 (`localhost` / `127.0.0.1` / `[::1]`) に完全一致
 * するならそのポート (既定ポートなら scheme の既定)。それ以外と、URL として読めない
 * ものは null
 */
export function loopbackPortOf(url: unknown): number | null {
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase()
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    return null
  }
  if (parsed.port) return Number(parsed.port)
  return DEFAULT_PORTS[parsed.protocol] ?? null
}
