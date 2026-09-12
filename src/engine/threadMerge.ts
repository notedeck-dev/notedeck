import type { NormalizedNote } from '@/adapters/types'
import {
  defaultGroupContext,
  type NoteGroupContext,
  selectPrimary,
} from '@/services/noteGroup'
import { nestedVariantKey, type VariantKey } from '@/services/noteKey'

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
  /**
   * 主ビュー。variant そのものを指す (複製しない)。
   * 複製すると楽観 patch が複製側に乗り、再マージで消える。
   */
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

/**
 * 同一 identity のフラグメント群から主ビューを選ぶ。規則は `noteGroup.selectPrimary`
 * (#1058 §5.2) と同じ 1 か所。数 (reactions / renoteCount / repliesCount) は主ビューの
 * 値をそのまま使い、合算も max もしない。
 */
function pickRepresentative(
  frags: ThreadFragment[],
  ctx: NoteGroupContext,
): {
  note: NormalizedNote
  variants: NoteVariant[]
} {
  const variants: NoteVariant[] = frags.map((f) => ({
    accountId: f.sourceAccountId,
    serverHost: f.note._serverHost,
    noteId: f.note.id,
  }))
  const note = selectPrimary(
    frags.map((f) => f.note),
    ctx,
  )
  return { note, variants }
}

/**
 * フラグメント中の replyId から親ノードの URI を解決する。
 * reply フィールドがあればその URI を直接取得。なければ既知ノートから ID で検索。
 */
function resolveParentUri(
  note: NormalizedNote,
  keyToUri: Map<VariantKey, string>,
): string | null {
  if (!note.replyId) return null
  if (note.reply) return note.reply._identity
  // 返信先はこの variant と同じアカウント経由で取得されている (行キーで引く、#1010)
  return keyToUri.get(nestedVariantKey(note, note.replyId)) ?? null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * 複数サーバーのスレッド断片を identity (正規化 AP object id) で統合し、
 * 1 つのスレッドツリーを構築する。
 *
 * @param fragments - 全アカウントから収集したノート群
 * @param focalUri  - フォーカルノート（照会対象）の identity
 * @param ctx       - 主ビュー選択の文脈 (省略時は述語なしの既定)
 */
export function mergeThreadFragments(
  fragments: ThreadFragment[],
  focalUri: string,
  ctx: NoteGroupContext = defaultGroupContext(),
): MergedThread | null {
  if (fragments.length === 0) return null

  // 1. URI → フラグメント群のマップを構築
  const byUri = new Map<string, ThreadFragment[]>()
  // 行キー → identity の逆引きマップ（replyId 解決用）
  const keyToUri = new Map<VariantKey, string>()

  for (const f of fragments) {
    const uri = f.note._identity
    const list = byUri.get(uri)
    if (list) {
      list.push(f)
    } else {
      byUri.set(uri, [f])
    }
    keyToUri.set(nestedVariantKey(f.note, f.note.id), uri)
  }

  // 2. 各 URI グループから代表ノードを生成
  const nodes = new Map<string, MergedThreadNode>()
  for (const [uri, frags] of byUri) {
    const { note, variants } = pickRepresentative(frags, ctx)
    nodes.set(uri, { note, variants, children: [] })
  }

  // 3. 親子関係を構築
  const childOf = new Map<string, string>() // childUri → parentUri
  for (const [uri, node] of nodes) {
    const parentUri = resolveParentUri(node.note, keyToUri)
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
      (n) => !childOf.has(n.note._identity),
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
  let currentUri = focal.note._identity
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
