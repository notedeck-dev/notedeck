import type { NormalizedNote } from '@/adapters/types'
import { getNoteUri } from '@/utils/noteUrl'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** マージ元ノート + 取得元情報 */
export interface ThreadFragment {
  note: NormalizedNote
  sourceAccountId: string
}

/** 同一ノートの各サーバーコピー */
export interface NoteVariant {
  accountId: string
  serverHost: string
  noteId: string
}

/** マージ済みノード */
export interface MergedThreadNode {
  /** 代表ノート（統計マージ済み） */
  note: NormalizedNote
  /** 同一ノートの各サーバーコピー */
  variants: NoteVariant[]
  children: MergedThreadNode[]
}

/** マージ結果 */
export interface MergedThread {
  ancestors: MergedThreadNode[]
  focal: MergedThreadNode
  children: MergedThreadNode[]
  stats: {
    totalNotes: number
    serversContributed: number
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** リアクション辞書を合算する（キーごとに sum） */
function mergeReactions(
  ...maps: Record<string, number>[]
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const m of maps) {
    for (const [key, count] of Object.entries(m)) {
      result[key] = (result[key] ?? 0) + count
    }
  }
  return result
}

/**
 * 同一 URI のフラグメント群から代表ノートを選出し、統計をマージする。
 * - reactions: 全 variant を合算
 * - renoteCount / repliesCount: 全 variant の max
 */
function pickRepresentative(frags: ThreadFragment[]): {
  note: NormalizedNote
  variants: NoteVariant[]
} {
  const variants: NoteVariant[] = frags.map((f) => ({
    accountId: f.sourceAccountId,
    serverHost: f.note._serverHost,
    noteId: f.note.id,
  }))

  // 代表ノート: repliesCount + renoteCount が最大のものをベースにする
  // biome-ignore lint/style/noNonNullAssertion: frags is guaranteed non-empty by caller
  let best = frags[0]!
  let bestScore = 0
  for (const f of frags) {
    const score = (f.note.repliesCount ?? 0) + (f.note.renoteCount ?? 0)
    if (score > bestScore) {
      best = f
      bestScore = score
    }
  }

  // 統計をマージ
  const mergedReactions = mergeReactions(...frags.map((f) => f.note.reactions))
  let maxRenoteCount = 0
  let maxRepliesCount = 0
  for (const f of frags) {
    maxRenoteCount = Math.max(maxRenoteCount, f.note.renoteCount ?? 0)
    maxRepliesCount = Math.max(maxRepliesCount, f.note.repliesCount ?? 0)
  }

  const note: NormalizedNote = {
    ...best.note,
    reactions: mergedReactions,
    renoteCount: maxRenoteCount,
    repliesCount: maxRepliesCount,
  }

  return { note, variants }
}

/**
 * フラグメント中の replyId から親ノードの URI を解決する。
 * reply フィールドがあればその URI を直接取得。なければ既知ノートから ID で検索。
 */
function resolveParentUri(
  note: NormalizedNote,
  idToUri: Map<string, string>,
): string | null {
  if (!note.replyId) return null
  if (note.reply) return getNoteUri(note.reply)
  return idToUri.get(note.replyId) ?? null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * 複数サーバーのスレッド断片を uri ベースで統合し、1 つのスレッドツリーを構築する。
 *
 * @param fragments - 全アカウントから収集したノート群
 * @param focalUri  - フォーカルノート（照会対象）の URI
 */
export function mergeThreadFragments(
  fragments: ThreadFragment[],
  focalUri: string,
): MergedThread | null {
  if (fragments.length === 0) return null

  // 1. URI → フラグメント群のマップを構築
  const byUri = new Map<string, ThreadFragment[]>()
  // noteId → URI の逆引きマップ（replyId 解決用）
  const idToUri = new Map<string, string>()

  for (const f of fragments) {
    const uri = getNoteUri(f.note)
    const list = byUri.get(uri)
    if (list) {
      list.push(f)
    } else {
      byUri.set(uri, [f])
    }
    idToUri.set(f.note.id, uri)
  }

  // 2. 各 URI グループから代表ノードを生成
  const nodes = new Map<string, MergedThreadNode>()
  for (const [uri, frags] of byUri) {
    const { note, variants } = pickRepresentative(frags)
    nodes.set(uri, { note, variants, children: [] })
  }

  // 3. 親子関係を構築
  const childOf = new Map<string, string>() // childUri → parentUri
  for (const [uri, node] of nodes) {
    const parentUri = resolveParentUri(node.note, idToUri)
    if (parentUri && nodes.has(parentUri)) {
      childOf.set(uri, parentUri)
    }
  }

  // 子を親に追加
  for (const [childUri, parentUri] of childOf) {
    const child = nodes.get(childUri)
    const parent = nodes.get(parentUri)
    if (child && parent) {
      parent.children.push(child)
    }
  }

  // children を createdAt 昇順でソート
  for (const node of nodes.values()) {
    node.children.sort((a, b) =>
      a.note.createdAt.localeCompare(b.note.createdAt),
    )
  }

  // 4. フォーカルノードを基点に ancestors / children を分離
  const focal = nodes.get(focalUri)
  if (!focal) {
    // フォーカルノードが見つからない場合、最初のルートノートで代替
    const firstRoot = [...nodes.values()].find(
      (n) => !childOf.has(getNoteUri(n.note)),
    )
    if (!firstRoot) return null
    return buildResult(firstRoot, nodes, childOf)
  }

  return buildResult(focal, nodes, childOf)
}

/** フォーカルノードから ancestors チェーンを遡り、結果を構築する */
function buildResult(
  focal: MergedThreadNode,
  nodes: Map<string, MergedThreadNode>,
  childOf: Map<string, string>,
): MergedThread {
  // ancestors: フォーカルから親を遡る
  const ancestors: MergedThreadNode[] = []
  let currentUri = getNoteUri(focal.note)
  const visited = new Set<string>()

  while (childOf.has(currentUri)) {
    const parentUri = childOf.get(currentUri)
    if (!parentUri || visited.has(parentUri)) break // 循環防止
    visited.add(parentUri)
    const parent = nodes.get(parentUri)
    if (!parent) break
    ancestors.unshift(parent)
    currentUri = parentUri
  }

  // 統計
  const serverHosts = new Set<string>()
  for (const node of nodes.values()) {
    for (const v of node.variants) {
      serverHosts.add(v.serverHost)
    }
  }

  return {
    ancestors,
    focal,
    children: focal.children,
    stats: {
      totalNotes: nodes.size,
      serversContributed: serverHosts.size,
    },
  }
}
