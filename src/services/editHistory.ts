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
  css: {
    label: 'カスタム CSS',
    language: 'css',
    snapshotText: (s) => field(s, 'body'),
    revertCapabilityId: 'styles.revert',
    // custom.css は単一ファイルなので対象 id を持たない
    revertParams: (_itemId, index) => ({ index }),
  },
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
