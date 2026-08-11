/**
 * 設定ファイル名の slug 化と衝突解決 (#913)。
 *
 * 不変条件: 正規アイテムのファイル basename は「slugify の不動点」
 * (小文字 `[a-z0-9-]`・48 文字上限・Windows 予約デバイス名でない)。
 * 規約適合の判定 (isSlugConforming) と生成 (slugifyName) は
 * 同じ変換を共有し、生成物が常に適合するよう保証する。
 *
 * 占有判定の casefold・探索空間 (対応表 ∪ ディレクトリ実列挙 ∪ ID 集合)
 * は呼び出し側の責務。ここは純関数のみ。
 */

export const SLUG_MAX_LENGTH = 48

/**
 * Windows 予約デバイス名。ファイル名の stem がこれに一致すると
 * Windows で作成・削除不能になるため、slug として出力しない。
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

/** ASCII case-insensitive 照合用の正規化。 */
export function casefold(s: string): string {
  return s.toLowerCase()
}

/** 末尾ハイフンの除去 (切り詰めで生じた分)。 */
function trimTrailingHyphens(s: string): string {
  return s.replace(/-+$/, '')
}

/** 予約名なら回避 suffix を付ける。上限内に収まるよう調整。 */
function avoidReserved(slug: string): string {
  if (!RESERVED_DEVICE_NAMES.has(slug)) return slug
  return `${slug}-x`
}

/**
 * 表示名を slug 化する。空になったら fallback (種別名) に落ちる。
 * 出力は常に isSlugConforming を満たす不動点。
 */
export function slugifyName(name: string, fallback: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
  slug = trimTrailingHyphens(slug)
  if (slug.length > SLUG_MAX_LENGTH) {
    slug = trimTrailingHyphens(slug.slice(0, SLUG_MAX_LENGTH))
  }
  if (!slug) slug = fallback
  return avoidReserved(slug)
}

/**
 * basename が規約適合か = slugify の不動点か。
 * 移行 (a) の正規化対象判定・新規書込の検証に使う。
 */
export function isSlugConforming(basename: string): boolean {
  if (!basename) return false
  // fallback を経由しない純変換との一致で判定する
  if (!/^[a-z0-9-]+$/.test(basename)) return false
  if (basename.length > SLUG_MAX_LENGTH) return false
  if (/--/.test(basename)) return false
  if (basename.startsWith('-') || basename.endsWith('-')) return false
  if (RESERVED_DEVICE_NAMES.has(basename)) return false
  return true
}

/**
 * base に連番 suffix を合成する。上限超過時は base 側を切り詰め、
 * 切断で生じた末尾ハイフンを除去して不動点を保つ。
 */
export function composeSuffixed(base: string, n: number): string {
  const suffix = `-${n}`
  let head = base
  if (head.length + suffix.length > SLUG_MAX_LENGTH) {
    head = trimTrailingHyphens(head.slice(0, SLUG_MAX_LENGTH - suffix.length))
  }
  return `${head}${suffix}`
}

/**
 * 空き名を探索する。base が占有されていれば `-2` から昇順連番。
 * isTaken には「対応表 ∪ ディレクトリ実列挙 ∪ (ID を決める操作では)
 * ID 集合」に対する casefold 済みの述語を渡すこと。
 */
export function resolveAvailable(
  base: string,
  isTaken: (candidate: string) => boolean,
): string {
  if (!isTaken(base)) return base
  for (let n = 2; ; n++) {
    const candidate = composeSuffixed(base, n)
    if (!isTaken(candidate)) return candidate
  }
}
