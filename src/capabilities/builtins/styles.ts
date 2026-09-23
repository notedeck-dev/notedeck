import type { Command } from '@/commands/registry'
import { appendBlock } from '@/services/selfEditApply'
import { useThemeStore } from '@/stores/theme'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'
import { implement } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'

/**
 * Styles (custom.css) 系 capability — 「自己拡張する IDE」の延長線
 * (memory: project_self_extending_ide_roadmap.md / feedback_ai_capability_scope)。
 *
 * theme は AI が編集可能だが custom.css は塞がっていたため対称性が崩れていた。
 * 本モジュールで AI から CSS を読取・追記・全置換・履歴閲覧・revert できる
 * ようにする。書込は全て `themeStore.setCustomCss` を経由するため、UI に
 * 即時反映 + ファイル永続化 + history sidecar push が連動する。
 *
 * 設計判断:
 * - read は permission 不要 (visual のみで機密を含まない、theme.read と対称)
 * - write / append / revert は `styles.write` permission + 確認ダイアログ
 * - 履歴は `custom.css.history.json5` (root 直下、HistoryKind='css')
 * - skill のような id ベースではなく単一ファイルなので全 capability で id 不要
 */

const CSS_HISTORY_BASENAME = 'custom.css'

interface CssSnapshot {
  body: string
}

export const stylesReadCapability = implement('styles.read', {
  execute: () => {
    const store = useThemeStore()
    const body = store.customCss
    return { body, length: body.length }
  },
})

export const stylesWriteCapability = implement('styles.write', {
  requiresConfirmation: (params, ctx) => {
    const body = typeof params?.body === 'string' ? params.body : ''
    const cur = useThemeStore().customCss
    stageEdit(ctx, cur, body)
    return {
      title: 'カスタム CSS を全置換',
      message:
        `custom.css の内容を ${body.length} 文字に全置換します。` +
        ' 現在の CSS は履歴に保存され、styles.revert で戻せます。',
      diff: { old: cur, new: body, language: 'css' },
      okLabel: '上書き',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: (params, ctx) => {
    const body = typeof params?.body === 'string' ? params.body : ''
    const store = useThemeStore()
    const next = takeStagedEdit(
      ctx,
      'styles.write',
      store.customCss,
      () => body,
    )
    store.setCustomCss(next, editAttribution(ctx, params))
    return { length: next.length }
  },
})

export const stylesAppendCapability = implement('styles.append', {
  requiresConfirmation: (params, ctx) => {
    const content = typeof params?.content === 'string' ? params.content : ''
    const cur = useThemeStore().customCss
    const next = stageEdit(ctx, cur, appendBlock(cur, content))
    return {
      title: 'カスタム CSS に追記',
      message:
        `custom.css の末尾に ${content.length} 文字を追記します。` +
        ' 既存ルールは保持されます。',
      diff: { old: cur, new: next, language: 'css' },
      okLabel: '追記',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: (params, ctx) => {
    const content = typeof params?.content === 'string' ? params.content : ''
    if (!content) throw new Error('styles.append: content is required')
    const store = useThemeStore()
    const prev = store.customCss
    const next = takeStagedEdit(ctx, 'styles.append', prev, () =>
      appendBlock(prev, content),
    )
    store.setCustomCss(next, editAttribution(ctx, params))
    return { length: next.length }
  },
})

export const stylesHistoryCapability = implement('styles.history', {
  execute: async () => {
    return await listSnapshots<CssSnapshot>('css', CSS_HISTORY_BASENAME)
  },
})

export const stylesRevertCapability = implement('styles.revert', {
  requiresConfirmation: async (params, ctx) => {
    const index = typeof params?.index === 'number' ? params.index : -1
    if (index < 0) return null
    const entry = await getSnapshotAt<CssSnapshot>(
      'css',
      CSS_HISTORY_BASENAME,
      index,
    )
    if (!entry) return null
    const cur = useThemeStore().customCss
    const next = stageEdit(ctx, cur, entry.snapshot.body)
    return {
      title: 'カスタム CSS を過去の状態に戻す',
      message:
        `custom.css を編集履歴 #${index} ` +
        `(${new Date(entry.at).toLocaleString()}) の状態に戻します。` +
        ' 現在の CSS は上書きされます (戻す操作自体も履歴に残ります)。',
      diff: { old: cur, new: next, language: 'css' },
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const index = typeof params?.index === 'number' ? params.index : -1
    if (index < 0) throw new Error('styles.revert: index must be >= 0')
    const entry = await getSnapshotAt<CssSnapshot>(
      'css',
      CSS_HISTORY_BASENAME,
      index,
    )
    if (!entry) {
      throw new Error(`styles.revert: no snapshot at index ${index}`)
    }
    const store = useThemeStore()
    const next = takeStagedEdit(
      ctx,
      'styles.revert',
      store.customCss,
      () => entry.snapshot.body,
    )
    store.setCustomCss(next, editAttribution(ctx, params))
    return { reverted: true, at: entry.at }
  },
})

export const STYLES_BUILTIN_CAPABILITIES: readonly Command[] = [
  stylesReadCapability,
  stylesWriteCapability,
  stylesAppendCapability,
  stylesHistoryCapability,
  stylesRevertCapability,
]
