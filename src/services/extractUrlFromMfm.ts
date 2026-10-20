/**
 * MFM ノード列から URL を再帰抽出するユーティリティ。
 * Misskey 本家 `packages/frontend/src/utility/extract-url-from-mfm.ts` 準拠。
 *
 * - `url` ノードと `link` ノードの URL を収集
 * - `link` の `silent === true` は既定で除外（`respectSilentFlag=false` で含む）
 * - `link` のラベルの中に含まれる `url` / `link` も再帰的に拾う
 * - 完全一致の重複排除 → ハッシュ (#...) 除去キーでの重複排除を 2 段で適用
 */
import type { MfmNode } from './mfmParser'

const removeHash = (url: string): string => url.replace(/#[^#]*$/, '')

export function extractUrlFromMfm(
  nodes: MfmNode[],
  respectSilentFlag = true,
): string[] {
  const collected: string[] = []
  walk(nodes, collected, respectSilentFlag)

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
  nodes: MfmNode[],
  out: string[],
  respectSilentFlag: boolean,
): void {
  for (const n of nodes) {
    if (n.type === 'url') {
      out.push(n.props.url)
    } else if (n.type === 'link') {
      if (!respectSilentFlag || !n.props.silent) out.push(n.props.url)
      walk(n.children, out, respectSilentFlag)
    } else if (n.type === 'list') {
      for (const item of n.props.items) walk(item, out, respectSilentFlag)
    } else if ('children' in n && n.children) {
      walk(n.children, out, respectSilentFlag)
    }
  }
}
