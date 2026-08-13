import { type Principal, principalActorLabel } from '@/permissions/principal'
import type { MisskeyTheme } from '@/theme/types'
import type { HistoryKind } from '@/utils/settingsFs'
import { serializeTheme } from './selfEditApply'

/**
 * 編集履歴 (`<basename>.history.json5`) を「読む側」の種別差分 (#981)。
 *
 * 履歴の書込 (pushSnapshot) は各 store が持つが、読んで diff で見せるには
 * 「snapshot をどう全文テキストにするか」「どの言語で描くか」「戻すのは
 * どの capability か」が種別ごとに要る。履歴ウィンドウが種別で分岐しない
 * よう、その差分だけをここに集める。
 */

export interface EditHistorySpec {
  /** 一覧・見出しに出す種別名 */
  label: string
  /** CodeDiffView に渡す言語キー */
  language: 'aiscript' | 'json5' | 'markdown' | 'css' | 'text'
  /** kind 固有の snapshot を全文テキストにする (壊れていれば空文字) */
  snapshotText: (snapshot: unknown) => string
  /** 「この状態に戻す」で呼ぶ capability */
  revertCapabilityId: string
  /** revert capability に渡す params */
  revertParams: (itemId: string, index: number) => Record<string, unknown>
}

function field(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const v = (snapshot as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

/** 履歴 snapshot からテーマ本体を復元する (メタは snapshot に無いので落ちる)。 */
export function themeFromSnapshot(snapshot: unknown): MisskeyTheme {
  const s = (
    snapshot && typeof snapshot === 'object' ? snapshot : {}
  ) as Partial<MisskeyTheme>
  return {
    id: typeof s.id === 'string' ? s.id : '',
    name: typeof s.name === 'string' ? s.name : '',
    base: s.base === 'light' ? 'light' : 'dark',
    props:
      s.props && typeof s.props === 'object' ? (s.props as typeof s.props) : {},
  }
}

export const EDIT_HISTORY_SPECS: Record<HistoryKind, EditHistorySpec> = {
  skill: {
    label: 'スキル',
    language: 'markdown',
    snapshotText: (s) => field(s, 'body'),
    revertCapabilityId: 'skills.revert',
    revertParams: (id, index) => ({ id, index }),
  },
  plugin: {
    label: 'プラグイン',
    language: 'aiscript',
    snapshotText: (s) => field(s, 'src'),
    revertCapabilityId: 'plugins.revert',
    revertParams: (installId, index) => ({ installId, index }),
  },
  widget: {
    label: 'ウィジェット',
    language: 'aiscript',
    snapshotText: (s) => field(s, 'src'),
    revertCapabilityId: 'widgets.revert',
    revertParams: (installId, index) => ({ installId, index }),
  },
  theme: {
    label: 'テーマ',
    language: 'json5',
    // props だけでは名前・base の変化が見えないのでテーマ全体を並べる
    snapshotText: (s) =>
      s && typeof s === 'object' ? serializeTheme(themeFromSnapshot(s)) : '',
    revertCapabilityId: 'theme.revert',
    revertParams: (id, index) => ({ id, index }),
  },
  memo: {
    label: 'メモ',
    language: 'markdown',
    snapshotText: (s) => field(s, 'body'),
    revertCapabilityId: 'memos.revert',
    revertParams: (id, index) => ({ id, index }),
  },
  css: {
    label: 'カスタム CSS',
    language: 'css',
    snapshotText: (s) => field(s, 'body'),
    revertCapabilityId: 'styles.revert',
    // custom.css は単一ファイルなので対象 id を持たない
    revertParams: (_itemId, index) => ({ index }),
  },
}

// --- 帰属・理由・保持方針 (#1052) ---

/**
 * 帰属と理由の判定に必要な最小形 (`historyFs.HistoryEntry` の部分集合)。
 * snapshot 本体は保持方針の判断に関係しないので受け取らない。
 */
export interface HistoryMeta {
  /** Unix ms */
  at: number
  /** 誰の編集か。記録を始める前のエントリには無い */
  by?: Principal
  /** なぜ変えたか。本人の手編集には付かない (#1052 — 空欄を並べない) */
  reason?: string
}

/**
 * 履歴一覧に出す帰属ラベル。
 *
 * 本人操作は確認ダイアログでは帰属を出さない (principalActorLabel が null) が、
 * 履歴では AI の編集と並ぶので「自分」と明示する。記録が無いエントリを「自分」に
 * 倒すと、記録開始前の AI の編集が本人のものに見えるため別ラベルにする。
 */
export function historyActorLabel(by?: Principal): string {
  if (!by) return '記録なし'
  return principalActorLabel(by) ?? '自分'
}

/** 連続した自動保存を 1 つの区切りとみなす窓 (#1052)。 */
export const COALESCE_WINDOW_MS = 60_000

function isSelfEdit(by?: Principal): boolean {
  // 記録前のエントリは本人の手編集として扱う (AI の編集は capability 経由の
  // 明示的な 1 回で、記録開始前でも連続保存では発生しない)
  return !by || by.kind === 'user'
}

/**
 * 直前のエントリに畳んで、新しい snapshot を積まずに済ませるか (#1052)。
 *
 * snapshot は「その編集の直前の状態」なので、連続保存では**古い方を残す** =
 * 後続の push を捨てるのが正しい畳み方になる。エディタはデバウンスの自動保存で、
 * 1 回の編集セッションが何件もの snapshot を生んでリングを埋める。
 *
 * 畳むのは本人の編集どうしに限る。AI の編集は 1 回ごとに理由が付くので、
 * 畳むと理由が消える。
 */
export function shouldCoalesceEdit(
  prev: HistoryMeta | undefined,
  next: { at: number; by?: Principal },
  windowMs: number = COALESCE_WINDOW_MS,
): boolean {
  if (!prev) return false
  if (!isSelfEdit(prev.by) || !isSelfEdit(next.by)) return false
  // 時刻の巻き戻り (システム時刻の変更) では畳まない — 窓の判定が成立しない
  if (next.at < prev.at) return false
  return next.at - prev.at < windowMs
}

/**
 * 保持の優先度。大きいほど残す。
 * 0 = 本人の理由なし編集 / 1 = 理由付きの本人編集 / 2 = 本人以外の編集
 */
function retentionRank(entry: HistoryMeta): number {
  if (!isSelfEdit(entry.by)) return 2
  return entry.reason ? 1 : 0
}

/**
 * 上限を超えた履歴を落とす (#1052)。entries は新しい順。
 *
 * 単純な古い順のリングだと、帰属や理由を記録しても本人の自動保存に押し出されて
 * 消える。捨てる順を優先度で決め、AI の編集と理由付きを最後まで残す。全件が
 * 保護対象なら最古から捨てる (履歴を無制限に増やさない)。
 */
export function evictHistory<T extends HistoryMeta>(
  entries: readonly T[],
  limit: number,
): T[] {
  if (entries.length <= limit) return [...entries]
  const doomed = new Set(
    entries
      .map((entry, index) => ({ index, rank: retentionRank(entry) }))
      // 優先度の低い順、同じ優先度なら古い順 (index が大きいほど古い)
      .sort((a, b) => a.rank - b.rank || b.index - a.index)
      .slice(0, entries.length - limit)
      .map((x) => x.index),
  )
  return entries.filter((_, index) => !doomed.has(index))
}

/**
 * 履歴一覧の index 番目を選んだときに見せる diff のペアを返す。
 *
 * snapshot は「その編集の直前の状態」なので、比較相手は 1 つ新しい snapshot
 * (無ければ現在の内容) になる。これで snapshot 間・snapshot vs 現在の両方が
 * 同じ 1 つの見え方に収まる。範囲外の index は null。
 */
export function historyDiffPair(
  snapshotTexts: readonly string[],
  index: number,
  current: string,
): { old: string; new: string } | null {
  const old = snapshotTexts[index]
  if (old === undefined) return null
  return { old, new: snapshotTexts[index - 1] ?? current }
}
