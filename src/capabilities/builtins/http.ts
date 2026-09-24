import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { implement } from '../declare'

/**
 * `http.fetch` — 外部 HTTP API (CORS なし) を叩く。Rust 側で SSRF / size /
 * timeout を防御するため、本 capability は薄い invoke ラッパに留める。
 *
 * AiScript からは `Nd:call('http.fetch', { url, ... })` または
 * `Nd:http(url, options)` (shorthand) で呼べる。permissions: `network.external`。
 */
export const httpFetchCapability = implement('http.fetch', {
  execute: async (params) => {
    const url = typeof params?.url === 'string' ? params.url : ''
    if (!url) throw new Error('url is required')
    const request = {
      url,
      method: typeof params?.method === 'string' ? params.method : null,
      headers: isStringRecord(params?.headers) ? params.headers : null,
      body: typeof params?.body === 'string' ? params.body : null,
      timeoutMs:
        typeof params?.timeoutMs === 'number' ? params.timeoutMs : null,
    }
    return unwrap(await commands.httpFetch(request))
  },
})

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== 'string') return false
  }
  return true
}

export const HTTP_BUILTIN_CAPABILITIES: readonly Command[] = [
  httpFetchCapability,
]
