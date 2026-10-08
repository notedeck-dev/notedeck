/**
 * タイムラインの可用性 / モード / フィルターの純ロジック。サーバー policy と
 * endpoint スキーマから「どの TL が出せるか」「どのモードか」「どのフィルターが
 * 効くか」を決める規則だけを置く。検出 (Tauri 経由の取得 + localStorage の
 * SWR キャッシュ + accounts store) と i18n ラベルは utils/customTimelines。
 */
import type { TimelineFilter, TimelineType } from '@/adapters/types'

// Regex patterns for policy/mode scanning (module-level to avoid recompilation in loops)
const TL_AVAILABLE_RE = /^(.+)TlAvailable$/
/** `isInYamiMode` → `Yami` (アカウント単位のモードキー) */
export const MODE_RE = /^isIn(.+)Mode$/
// アカウント単位 (isIn*Mode) とノート単位 (isNoteIn*Mode) の両方からモード名を取る
const MODE_NAME_RE = /^is(?:Note)?In(.+)Mode$/

// --- Timeline availability via user policies ---

/** Standard policy key → timeline types it gates */
const POLICY_TIMELINE_MAP: Record<string, TimelineType[]> = {
  ltlAvailable: ['local', 'social'],
  gtlAvailable: ['global'],
}
const POLICY_HANDLED_KEYS = new Set(Object.keys(POLICY_TIMELINE_MAP))

/**
 * Given a timeline type, return all types in the same policy group.
 * e.g., 'local' → ['local', 'social'] (both gated by ltlAvailable)
 */
export function getRelatedTimelineTypes(tlType: string): string[] {
  for (const types of Object.values(POLICY_TIMELINE_MAP)) {
    if (types.includes(tlType as TimelineType)) {
      return [...types]
    }
  }
  return [tlType]
}

/**
 * Translate a flat policies object into TL availability/denial sets.
 * Shared by authenticated (i/get-policies) and unauthenticated (meta.policies) paths.
 *
 * policy を 1 つも返さないサーバー (旧版) は標準 TL を全部出し、policy が
 * あるときは true のものだけ出す。フォーク固有の `<name>TlAvailable` も同じ規則。
 */
export function applyPoliciesToAvailability(
  policies: Record<string, boolean>,
  available: TimelineType[],
  denied: Set<string>,
): void {
  const hasPolicySupport = Object.keys(policies).length > 0
  for (const [policyKey, tlTypes] of Object.entries(POLICY_TIMELINE_MAP)) {
    if (hasPolicySupport) {
      if (policies[policyKey] === true) {
        available.push(...tlTypes)
      } else {
        for (const t of tlTypes) denied.add(t)
      }
    } else {
      available.push(...tlTypes)
    }
  }
  for (const [key, value] of Object.entries(policies)) {
    if (POLICY_HANDLED_KEYS.has(key)) continue
    const match = key.match(TL_AVAILABLE_RE)
    if (!match) continue
    const type = match[1] as string
    if (value === true) {
      available.push(type)
    } else {
      denied.add(type)
    }
  }
}

// --- Mode flags ---

/**
 * モード名 → Tabler アイコン名 (`ti-` プレフィックスなし) の on/off 対。
 * フォーク本家の実装に合わせる:
 * - yamisskey: やみノート切り替えが `ti-moon` / `ti-moon-off`、ノートのバッジも `ti-moon`
 * - はなみすきー: はなモードが独自グリフ `ti-hanamisskey-hanamode` (花)、通常モードが
 *   `ti-users-group`。独自グリフは Tabler の配布フォントに無いので `flower` で代替し、
 *   off 側は yami と同じく `-off` 対で揃える (トグルとして読めることを優先)
 */
const MODE_ICONS: Record<string, { on: string; off: string }> = {
  yami: { on: 'moon', off: 'moon-off' },
  hana: { on: 'flower', off: 'flower-off' },
}

/** `isInYamiMode` / `isNoteInYamiMode` → `yami`。パターン外は null */
function modeName(key: string): string | null {
  return key.match(MODE_NAME_RE)?.[1]?.toLowerCase() ?? null
}

/** モードトグルの Tabler アイコン名 (`ti-` プレフィックスなし) */
export function modeIcon(key: string, active: boolean): string {
  const icons = MODE_ICONS[modeName(key) ?? '']
  if (!icons) return active ? 'toggle-right' : 'toggle-left'
  return active ? icons.on : icons.off
}

/**
 * ノートに付けるモードバッジの Tabler アイコン名。トグルではないので、
 * 未知のモードはトグルアイコンではなく中立な印にフォールバックする。
 */
export function noteModeBadgeIcon(key: string): string {
  return MODE_ICONS[modeName(key) ?? '']?.on ?? 'circle-dot'
}

/**
 * Find the mode key (e.g., 'isInYamiMode') for a custom timeline type.
 * Uses heuristic: TL type starts with the mode name extracted from the key.
 * e.g., 'yami' matches 'isInYamiMode', 'hanami' matches 'isInHanaMode'.
 */
export function findModeKeyForTimeline(
  tlType: string,
  modes: Record<string, boolean>,
): string | undefined {
  for (const key of Object.keys(modes)) {
    const match = key.match(MODE_RE)
    if (!match) continue
    if (match[1] && tlType.startsWith(match[1].toLowerCase())) return key
  }
  return undefined
}

// --- Filter keys ---

/**
 * Canonical filter key → possible API parameter names (including fork aliases).
 * Some forks use inverted names (e.g., excludeBots instead of withBots).
 */
export const FILTER_PARAM_ALIASES: Record<keyof TimelineFilter, string[]> = {
  withRenotes: ['withRenotes'],
  withReplies: ['withReplies'],
  withFiles: ['withFiles'],
  withBots: ['withBots', 'excludeBots'],
  withSensitive: ['withSensitive', 'excludeNsfw'],
}

export const KNOWN_FILTER_KEYS = Object.keys(
  FILTER_PARAM_ALIASES,
) as (keyof TimelineFilter)[]

/**
 * 全アカウント面の組込フィルタ候補: 対象サーバー全部が対応するキーだけ
 * (既知の順)。片方だけ対応するキーを出すと、効くサーバーと効かないサーバーが
 * 混ざって「なぜ一部だけ残るのか」が追えない。対象が無ければ空
 */
export function commonFilterKeys(
  perHost: readonly (readonly (keyof TimelineFilter)[])[],
): (keyof TimelineFilter)[] {
  if (perHost.length === 0) return []
  return KNOWN_FILTER_KEYS.filter((k) =>
    perHost.every((keys) => keys.includes(k)),
  )
}
