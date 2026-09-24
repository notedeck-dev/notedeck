import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * `http.fetch` — 外部 HTTP API (CORS なし) を叩く。Rust 側で SSRF / size /
 * timeout を防御するため、本 capability は薄い invoke ラッパに留める。
 *
 * AiScript からは `Nd:call('http.fetch', { url, ... })` または
 * `Nd:http(url, options)` (shorthand) で呼べる。permissions: `network.external`。
 */
export const httpFetchCapability = implementCore('http.fetch')

export const HTTP_BUILTIN_CAPABILITIES: readonly Command[] = [
  httpFetchCapability,
]
