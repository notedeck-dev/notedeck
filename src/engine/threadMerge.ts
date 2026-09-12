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

/** 主ビュー選択に使うアカウント情報 (並び順 = アカウント一覧の順) */
export interface ThreadMergeAccount {
  id: string
  userId: string
  hasToken: boolean
}

export interface ThreadMergeContext {
  accounts?: ReadonlyArray<ThreadMergeAccount>
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

/** URI の host (ポート込み・小文字)。解釈できなければ null */
function hostOf(uri: string): string | null {
  try {
    return new URL(uri).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 同一 URI のフラグメント群から主ビューを選ぶ。
 *
 * 数 (reactions / renoteCount / repliesCount) は主ビューの値をそのまま使い、
 * 合算も max もしない。Like はオリジンと反応者のフォロワー先の両方に配送される
 * ので足すと二重計上になり、max は取消が一方にしか届かないと膨らむ (#1058)。
 *
 * ランク (静的な事実だけ。取得順・数に依存しない):
 *   1. トークンを持つアカウントの variant (ゲスト取得は最下位)
 *   2. variant のアカウントが投稿者本人
 *   3. origin (URI の host == 取得元サーバー) の variant
 *   4. アカウント一覧の並び順
 * ctx が無いときは 3 のみ評価し、同点は最初のフラグメント。
 */
function pickRepresentative(
  frags: ThreadFragment[],
  ctx: ThreadMergeContext | undefined,
): {
  note: NormalizedNote
  variants: NoteVariant[]
} {
  const variants: NoteVariant[] = frags.map((f) => ({
    accountId: f.sourceAccountId,
    serverHost: f.note._serverHost,
    noteId: f.note.id,
  }))

  const accountIndex = new Map<string, number>()
  const accountById = new Map<string, ThreadMergeAccount>()
  for (const [i, a] of (ctx?.accounts ?? []).entries()) {
    accountIndex.set(a.id, i)
    accountById.set(a.id, a)
  }

  const scoreOf = (f: ThreadFragment): number[] => {
    const account = accountById.get(f.sourceAccountId)
    const hasToken = account?.hasToken ? 1 : 0
    const isAuthor = account && account.userId === f.note.user.id ? 1 : 0
    const isOrigin =
      hostOf(getNoteUri(f.note)) === f.note._serverHost.toLowerCase() ? 1 : 0
    const order = -(
      accountIndex.get(f.sourceAccountId) ?? Number.MAX_SAFE_INTEGER
    )
    return [hasToken, isAuthor, isOrigin, order]
  }

  // biome-ignore lint/style/noNonNullAssertion: frags is guaranteed non-empty by caller
  let best = frags[0]!
  let bestScore = scoreOf(best)
  for (const f of frags.slice(1)) {
    const score = scoreOf(f)
    if (compareScore(score, bestScore) > 0) {
      best = f
      bestScore = score
    }
  }

  return { note: best.note, variants }
}

/** 辞書順比較。a > b なら正 */
function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
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
 * @param ctx       - 主ビュー選択に使うアカウント情報 (省略可)
 */
export function mergeThreadFragments(
  fragments: ThreadFragment[],
  focalUri: string,
  ctx?: ThreadMergeContext,
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
    const { note, variants } = pickRepresentative(frags, ctx)
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
