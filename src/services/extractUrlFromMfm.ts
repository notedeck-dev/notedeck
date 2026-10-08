/**
 * MFM トークン列から URL を再帰抽出するユーティリティ。
 * Misskey 本家 `packages/frontend/src/utility/extract-url-from-mfm.ts` 準拠。
 *
 * - `url` トークンと `link` トークンの URL を収集
 * - `link` の `silent === true` は既定で除外（`respectSilentFlag=false` で含む）
 * - `link.label` の中に含まれる `url` / `link` も再帰的に拾う
 * - 完全一致の重複排除 → ハッシュ (#...) 除去キーでの重複排除を 2 段で適用
 */
import type { MfmToken } from './mfmParser'

const removeHash = (url: string): string => url.replace(/#[^#]*$/, '')

export function extractUrlFromMfm(
  tokens: MfmToken[],
  respectSilentFlag = true,
): string[] {
  const collected: string[] = []
  walk(tokens, collected, respectSilentFlag)

  const seen = new Set<string>()
  const unique: string[] = []
  for (const url of collected) {
    if (!seen.has(url)) {
      seen.add(url)
      unique.push(url)
    }
  }

  return unique.reduce<string[]>((acc, url) => {
    const key = removeHash(url)
    if (!acc.some((x) => removeHash(x) === key)) acc.push(url)
    return acc
  }, [])
}

function walk(
  tokens: MfmToken[],
  out: string[],
  respectSilentFlag: boolean,
): void {
  for (const t of tokens) {
    switch (t.type) {
      case 'url':
        out.push(t.value)
        break
      case 'link':
        if (!respectSilentFlag || !t.silent) out.push(t.url)
        walk(t.label, out, respectSilentFlag)
        break
      case 'bold':
      case 'italic':
      case 'strike':
      case 'small':
      case 'center':
      case 'quote':
      case 'fn':
        walk(t.children, out, respectSilentFlag)
        break
    }
  }
}
