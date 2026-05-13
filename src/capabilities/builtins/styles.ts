import type { Command } from '@/commands/registry'
import { useThemeStore } from '@/stores/theme'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'

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

export const stylesReadCapability: Command = {
  id: 'styles.read',
  label: 'カスタム CSS を読む',
  icon: 'ti-brush',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在の custom.css の内容を返す。CSS 変数の上書きや独自ルール等を' +
      ' AI が確認するために使う。',
    params: {},
    returns: {
      type: 'object',
      description: '{ body: string, length: number }',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useThemeStore()
    const body = store.customCss
    return { body, length: body.length }
  },
}

export const stylesWriteCapability: Command = {
  id: 'styles.write',
  label: 'カスタム CSS を全置換',
  icon: 'ti-brush',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['styles.write'],
  requiresConfirmation: (params) => {
    const body = typeof params?.body === 'string' ? params.body : ''
    return {
      title: 'カスタム CSS を全置換',
      message:
        `custom.css の内容を ${body.length} 文字に全置換します。` +
        ' 現在の CSS は履歴に保存され、styles.revert で戻せます。',
      code: body,
      codeLanguage: 'css',
      okLabel: '上書き',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'custom.css の内容を `body` で全置換する。差分編集ではなく完全上書き' +
      'なので、styles.read で現状を取得してからマージした内容を渡すこと。',
    params: {
      body: {
        type: 'string',
        description: '新しい custom.css 全文',
      },
    },
    returns: {
      type: 'object',
      description: '{ length: 書込後の文字数 }',
    },
  },
  visible: false,
  execute: (params) => {
    const body = typeof params?.body === 'string' ? params.body : ''
    const store = useThemeStore()
    store.setCustomCss(body)
    return { length: body.length }
  },
}

export const stylesAppendCapability: Command = {
  id: 'styles.append',
  label: 'カスタム CSS に追記',
  icon: 'ti-plus',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['styles.write'],
  requiresConfirmation: (params) => {
    const content = typeof params?.content === 'string' ? params.content : ''
    return {
      title: 'カスタム CSS に追記',
      message:
        `custom.css の末尾に ${content.length} 文字を追記します。` +
        ' 既存ルールは保持されます。',
      code: content,
      codeLanguage: 'css',
      okLabel: '追記',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  signature: {
    description:
      'custom.css の末尾に CSS を追記する。既存ルールには触らない' +
      ' (= 学習が積み上がる、skills.append と対称)。',
    params: {
      content: {
        type: 'string',
        description: '末尾に追記する CSS (改行は \\n)',
      },
    },
    returns: {
      type: 'object',
      description: '{ length: 追記後の文字数 }',
    },
  },
  visible: false,
  execute: (params) => {
    const content = typeof params?.content === 'string' ? params.content : ''
    if (!content) throw new Error('styles.append: content is required')
    const store = useThemeStore()
    const prev = store.customCss
    const sep = prev.length === 0 || prev.endsWith('\n') ? '' : '\n'
    const next = `${prev}${sep}${content}`
    store.setCustomCss(next)
    return { length: next.length }
  },
}

export const stylesHistoryCapability: Command = {
  id: 'styles.history',
  label: 'カスタム CSS の編集履歴',
  icon: 'ti-history',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      'custom.css の編集前 snapshot 一覧 (新しい順、最大 10 件) を返す。' +
      ' 各エントリは { at: 時刻 ms, snapshot: { body } }。',
    params: {},
    returns: {
      type: 'array',
      description: '編集前 snapshot の配列 (新しい順)',
    },
    cheap: true,
  },
  visible: false,
  execute: async () => {
    return await listSnapshots<CssSnapshot>('css', CSS_HISTORY_BASENAME)
  },
}

export const stylesRevertCapability: Command = {
  id: 'styles.revert',
  label: 'カスタム CSS を過去の状態に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['styles.write'],
  requiresConfirmation: async (params) => {
    const index = typeof params?.index === 'number' ? params.index : -1
    if (index < 0) return null
    const entry = await getSnapshotAt<CssSnapshot>(
      'css',
      CSS_HISTORY_BASENAME,
      index,
    )
    if (!entry) return null
    return {
      title: 'カスタム CSS を過去の状態に戻す',
      message:
        `custom.css を編集履歴 #${index} ` +
        `(${new Date(entry.at).toLocaleString()}) の状態に戻します。` +
        ' 現在の CSS は上書きされます (戻す操作自体も履歴に残ります)。',
      code: entry.snapshot.body,
      codeLanguage: 'css',
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'custom.css を編集履歴の index 番目の snapshot に戻す。' +
      ' styles.history で index を取得。',
    params: {
      index: {
        type: 'number',
        description: 'snapshot index (0 = 最新、styles.history の順序と一致)',
      },
    },
    returns: {
      type: 'object',
      description: '{ reverted: boolean, at: number }',
    },
  },
  visible: false,
  execute: async (params) => {
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
    store.setCustomCss(entry.snapshot.body)
    return { reverted: true, at: entry.at }
  },
}

export const STYLES_BUILTIN_CAPABILITIES: readonly Command[] = [
  stylesReadCapability,
  stylesWriteCapability,
  stylesAppendCapability,
  stylesHistoryCapability,
  stylesRevertCapability,
]
