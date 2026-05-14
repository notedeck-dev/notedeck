import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'
import { useMisStoreStore } from '@/stores/misstore'
import { useThemeStore } from '@/stores/theme'
import type { MisskeyTheme } from '@/theme/types'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'

interface ThemeSnapshot {
  id: string
  name: string
  base?: 'dark' | 'light'
  props: Record<string, string>
}

/**
 * `theme.list` — インストール済みテーマの一覧を返す。
 * AI が `theme.apply` で渡す ID を確認するために使う。
 */
export const themeListCapability: Command = {
  id: 'theme.list',
  label: 'テーマ一覧',
  icon: 'ti-palette',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      'インストール済みテーマの一覧を返す。各要素は { id, name, base, author }',
    params: {},
    returns: {
      type: 'array',
      description: 'インストール済みテーマ一覧',
    },
  },
  visible: false,
  execute: () => {
    const store = useThemeStore()
    return store.installedThemes.map((t) => ({
      id: t.id,
      name: t.name,
      base: t.base ?? null,
      // Misskey 互換 JSON には author が入るが MisskeyTheme 型には未宣言。
      // 値が存在すれば string として返す (なければ null)。
      author:
        typeof (t as unknown as { author?: unknown }).author === 'string'
          ? (t as unknown as { author: string }).author
          : null,
    }))
  },
}

/**
 * `theme.apply` — 指定 id のテーマを適用する。
 * テーマの `base` ('dark' | 'light') から適用先 mode を自動判定する。
 * `theme.list` で取得した id を渡す想定。
 */
/**
 * `theme.read` — 指定 id のテーマの中身 (props) を返す。
 * AI が「現在の配色を見て調整」のように、theme.update を呼ぶ前の現状把握用。
 * 色情報は機密ではないため permission 不要 (theme.list / apply と同じ扱い)。
 */
export const themeReadCapability: Command = {
  id: 'theme.read',
  label: 'テーマの内容を読む',
  icon: 'ti-palette',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '指定 id のテーマの全プロパティ (Misskey 互換 CSS 変数) を返す。' +
      ' theme.update で差分編集する前の現状把握に使う。',
    params: {
      id: {
        type: 'string',
        description: '対象テーマの id (theme.list で取得)',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, name, base, props: Record<string,string> }',
    },
    cheap: true,
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('theme.read: id is required')
    const store = useThemeStore()
    const theme = store.installedThemes.find((t) => t.id === id)
    if (!theme) {
      throw new Error(`theme.read: theme "${id}" is not installed`)
    }
    return {
      id: theme.id,
      name: theme.name,
      base: theme.base ?? null,
      props: { ...theme.props },
    }
  },
}

export const themeApplyCapability: Command = {
  id: 'theme.apply',
  label: 'テーマを適用',
  icon: 'ti-palette',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      'インストール済みテーマを適用する。' +
      ' theme.list で id を取得してから呼ぶ。' +
      ' mode はテーマの base から自動判定 (省略可)。',
    params: {
      id: {
        type: 'string',
        description: '適用するテーマの id (theme.list で取得)',
      },
      mode: {
        type: 'string',
        description:
          '明示的に dark / light どちらの slot に適用するか。省略時はテーマ自体の base を使う',
        enum: ['dark', 'light'],
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '`{ applied: boolean, id, mode }`',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('theme.apply: id is required')
    const store = useThemeStore()
    const theme = store.installedThemes.find((t) => t.id === id)
    if (!theme) {
      throw new Error(`theme.apply: theme "${id}" is not installed`)
    }
    const explicitMode =
      params?.mode === 'dark' || params?.mode === 'light' ? params.mode : null
    const mode: 'dark' | 'light' =
      explicitMode ?? (theme.base === 'light' ? 'light' : 'dark')
    store.selectTheme(id, mode)
    // 適用モード != 現在アプリモードなら manualMode も切り替えて画面に反映
    // (= ライトテーマ apply 時はライトモードに自動切替)
    if (store.isCurrentDark() !== (mode === 'dark')) {
      store.manualMode = mode
      store.applyCurrentTheme()
    }
    return { applied: true, id, mode }
  },
}

/**
 * `theme.create` — 新規テーマを installedThemes に追加する。
 * AI が「ユーザーの好みに合わせて配色提案」「メモのトーンに合わせた季節テーマ」
 * のように動的にテーマを作るための capability。frontmatter 相当の id は
 * 衝突しないよう自動生成 (`custom-<timestamp>`) でも、明示指定でも OK。
 */
export const themeCreateCapability: Command = {
  id: 'theme.create',
  label: 'テーマを作成',
  icon: 'ti-palette',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['theme.write'],
  requiresConfirmation: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const base = typeof params?.base === 'string' ? params.base : ''
    const props = isStringRecord(params?.props) ? params.props : null
    const id = typeof params?.id === 'string' ? params.id : ''
    return {
      title: 'テーマをインストール',
      message: `AI が生成した ${base === 'light' ? 'ライト' : 'ダーク'} テーマをインストールします。`,
      installPreview: {
        kind: 'theme',
        name,
        version: id || undefined,
        description: props
          ? `${Object.keys(props).length} 個の CSS 変数を含む ${base} テーマ`
          : undefined,
      },
      code: props ? JSON.stringify(props, null, 2) : '',
      codeLanguage: 'json',
      okLabel: 'インストール',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  signature: {
    description:
      '新規テーマを作成して installedThemes に追加する。' +
      ' props は Misskey 互換 CSS 変数 (例: { accent: "#5f6", panel: "#0a0a0a" })。' +
      ' 既存 id を指定した場合は theme.update と同等の挙動になる。',
    params: {
      name: { type: 'string', description: 'テーマ名 (UI 表示用)' },
      base: {
        type: 'string',
        description: 'ダーク / ライト どちらの slot に置くか',
        enum: ['dark', 'light'],
      },
      props: {
        type: 'object',
        description: 'Misskey 互換 CSS 変数のマップ ({ key: string })',
      },
      id: {
        type: 'string',
        description: 'テーマ id (省略時は custom-<timestamp> で自動生成)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ id, name, base, installed: boolean }',
    },
  },
  visible: false,
  execute: async (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const baseRaw = typeof params?.base === 'string' ? params.base : ''
    const props = isStringRecord(params?.props) ? params.props : null
    const explicitId = typeof params?.id === 'string' ? params.id : ''
    if (!name) throw new Error('theme.create: name is required')
    if (baseRaw !== 'dark' && baseRaw !== 'light') {
      throw new Error('theme.create: base must be "dark" or "light"')
    }
    if (!props) {
      throw new Error('theme.create: props must be an object of string values')
    }
    const theme: MisskeyTheme = {
      id: explicitId || `custom-${Date.now()}`,
      name,
      base: baseRaw,
      props,
    }
    const store = useThemeStore()
    // テーママネージャーカラムは `$notedeck.installedFor` が現アカウントを
    // 含むテーマだけを表示する (孤児テーマは非表示)。AI が作ったテーマも
    // ユーザーから見えるよう、全 logged-in account を自動で installedFor に
    // 入れる。
    const accounts = useAccountsStore()
    const forAccountIds = accounts.accounts.map((a) => a.id)
    const installed = await store.installTheme(
      JSON.stringify(theme),
      forAccountIds,
    )
    return { id: theme.id, name: theme.name, base: theme.base, installed }
  },
}

/**
 * `theme.update` — 既存テーマの props / name / base を部分更新する。
 * 内部的には installTheme (= upsert) を呼ぶので、id 不一致なら新規扱いに
 * ならないよう execute 側で必ず id 存在チェックを行う。
 */
export const themeUpdateCapability: Command = {
  id: 'theme.update',
  label: 'テーマを更新',
  icon: 'ti-palette',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['theme.write'],
  requiresConfirmation: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const cur = useThemeStore().installedThemes.find((t) => t.id === id)
    if (!cur) return null
    const newName =
      typeof params?.name === 'string' && params.name.length > 0
        ? params.name
        : cur.name
    const newBase =
      params?.base === 'dark' || params?.base === 'light'
        ? params.base
        : (cur.base ?? 'dark')
    const patch = isStringRecord(params?.props) ? params.props : null
    return {
      title: 'テーマを更新',
      message: patch
        ? `${cur.name} の ${Object.keys(patch).length} 個の CSS 変数を更新します。`
        : `${cur.name} のメタ情報を更新します。`,
      installPreview: {
        kind: 'theme',
        name: newName,
        version: id,
        description: `${newBase} テーマ`,
      },
      code: patch ? JSON.stringify(patch, null, 2) : '',
      codeLanguage: 'json',
      okLabel: '更新',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      '既存テーマの props / name / base を部分更新する。指定された' +
      'フィールドだけ上書きされる。id は theme.list で取得した値を渡す。',
    params: {
      id: { type: 'string', description: '対象テーマの id' },
      name: { type: 'string', description: '新しいテーマ名', optional: true },
      base: {
        type: 'string',
        description: 'ダーク / ライト',
        enum: ['dark', 'light'],
        optional: true,
      },
      props: {
        type: 'object',
        description:
          '上書きする CSS 変数 ({ key: string })。既存とマージされる',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ id, updated: boolean }',
    },
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('theme.update: id is required')
    const store = useThemeStore()
    const current = store.installedThemes.find((t) => t.id === id)
    if (!current) {
      throw new Error(`theme.update: theme "${id}" is not installed`)
    }
    const name =
      typeof params?.name === 'string' && params.name.length > 0
        ? params.name
        : current.name
    const baseRaw = typeof params?.base === 'string' ? params.base : ''
    const base: 'dark' | 'light' =
      baseRaw === 'dark' || baseRaw === 'light'
        ? baseRaw
        : (current.base ?? 'dark')
    const propsPatch = isStringRecord(params?.props) ? params.props : null
    const merged: MisskeyTheme = {
      id,
      name,
      base,
      props: propsPatch ? { ...current.props, ...propsPatch } : current.props,
    }
    if (current.$notedeck) merged.$notedeck = current.$notedeck
    const updated = await store.installTheme(JSON.stringify(merged))
    return { id, updated }
  },
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== 'string') return false
  }
  return true
}

export const themeHistoryCapability: Command = {
  id: 'theme.history',
  label: 'テーマの編集履歴',
  icon: 'ti-history',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '指定 id のテーマの編集前 snapshot 一覧 (新しい順、最大 10 件) を返す。',
    params: {
      id: { type: 'string', description: '対象テーマの id' },
    },
    returns: {
      type: 'array',
      description: '編集前 snapshot の配列 (新しい順)',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('theme.history: id is required')
    return await listSnapshots<ThemeSnapshot>('theme', id)
  },
}

export const themeRevertCapability: Command = {
  id: 'theme.revert',
  label: 'テーマを過去の状態に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['theme.write'],
  requiresConfirmation: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!id || index < 0) return null
    const entry = await getSnapshotAt<ThemeSnapshot>('theme', id, index)
    if (!entry) return null
    const snap = entry.snapshot
    return {
      title: 'テーマを過去の状態に戻す',
      message:
        `${snap.name} を編集履歴 #${index} ` +
        `(${new Date(entry.at).toLocaleString()}) の状態に戻します。`,
      installPreview: {
        kind: 'theme',
        name: snap.name,
        version: snap.id,
        description: `${snap.base ?? 'dark'} テーマ / ${Object.keys(snap.props).length} 変数`,
      },
      code: JSON.stringify(snap.props, null, 2),
      codeLanguage: 'json',
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description: 'テーマ props を編集履歴の index 番目に戻す。',
    params: {
      id: { type: 'string', description: '対象テーマの id' },
      index: { type: 'number', description: 'snapshot index (0 = 最新)' },
    },
    returns: {
      type: 'object',
      description: '{ id, reverted: boolean, at: number }',
    },
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!id) throw new Error('theme.revert: id is required')
    if (index < 0) throw new Error('theme.revert: index must be >= 0')
    const entry = await getSnapshotAt<ThemeSnapshot>('theme', id, index)
    if (!entry) {
      throw new Error(`theme.revert: no snapshot at index ${index}`)
    }
    const restored: MisskeyTheme = {
      id: entry.snapshot.id,
      name: entry.snapshot.name,
      base: entry.snapshot.base,
      props: entry.snapshot.props,
    }
    const store = useThemeStore()
    await store.installTheme(JSON.stringify(restored))
    return { id, reverted: true, at: entry.at }
  },
}

/**
 * `theme.install` — MisStore (misstore.hital.in) から既製テーマを取得して
 * installedThemes に追加する。AI が「ダークなら Dracula が定番」のように
 * 推薦して install まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installTheme(entry, forAccountIds)` を呼ぶだけ。
 * sha512 検証・$notedeck.storeId 紐付け・既存 installedFor の union は
 * misstore store 側で実装済。
 */
export const themeInstallCapability: Command = {
  id: 'theme.install',
  label: 'MisStore からテーマを入れる',
  icon: 'ti-download',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['theme.write', 'network.external'],
  requiresConfirmation: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const misStore = useMisStoreStore()
    await misStore.fetchThemes()
    const entry = misStore.themes.find((t) => t.id === id)
    if (!entry) return null
    return {
      title: 'MisStore からテーマを入れる',
      message: `${entry.name} (${entry.base} / by ${entry.author}) を MisStore から取得してインストールします。`,
      installPreview: {
        kind: 'theme',
        name: entry.name,
        version: entry.version,
        author: entry.author,
        description: entry.description,
      },
      code: JSON.stringify(entry.themeProps, null, 2),
      codeLanguage: 'json',
      okLabel: 'インストール',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  signature: {
    description:
      'MisStore (misstore.hital.in) の既製テーマをインストールする。' +
      ' id は `misstore.search` で取得した値を渡す。' +
      ' sha512 検証付き。インストール後は theme.apply で適用可能。',
    params: {
      id: {
        type: 'string',
        description: 'MisStore registry 上の theme id (例: "ame", "dracula")',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, name, base, installed: boolean }',
    },
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('theme.install: id is required')
    const misStore = useMisStoreStore()
    await misStore.fetchThemes()
    const entry = misStore.themes.find((t) => t.id === id)
    if (!entry) {
      throw new Error(
        `theme.install: theme "${id}" not found in MisStore (try misstore.search first)`,
      )
    }
    const accounts = useAccountsStore()
    const forAccountIds = accounts.accounts.map((a) => a.id)
    await misStore.installTheme(entry, forAccountIds)
    return {
      id: entry.id,
      name: entry.name,
      base: entry.base,
      installed: true,
    }
  },
}

/**
 * `theme.uninstall` — インストール済みテーマを完全削除する。
 * cross-account (Global) からの除去と同等で、ファイル・selection・
 * applyCurrentTheme まで連動する。per-account 紐付けの解除は別途
 * 設計が必要なため、ここではシンプルに「完全削除」に統一する。
 */
export const themeUninstallCapability: Command = {
  id: 'theme.uninstall',
  label: 'テーマを削除',
  icon: 'ti-trash',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['theme.write'],
  requiresConfirmation: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const theme = useThemeStore().installedThemes.find((t) => t.id === id)
    if (!theme) return null
    return {
      title: 'テーマを削除',
      message: `${theme.name} (${theme.base ?? 'dark'}) を完全に削除します。元に戻すには再インストールが必要です。`,
      installPreview: {
        kind: 'theme',
        name: theme.name,
        version: id,
        description: `${theme.base ?? 'dark'} テーマ / ${Object.keys(theme.props).length} 変数`,
      },
      code: JSON.stringify(theme.props, null, 2),
      codeLanguage: 'json',
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  signature: {
    description:
      'インストール済みテーマを完全削除する。選択中だった場合は selection も解除され、' +
      ' デフォルトテーマにフォールバックする。',
    params: {
      id: { type: 'string', description: '削除するテーマの id' },
    },
    returns: {
      type: 'object',
      description: '{ id, removed: boolean }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('theme.uninstall: id is required')
    const store = useThemeStore()
    const theme = store.installedThemes.find((t) => t.id === id)
    if (!theme) {
      throw new Error(`theme.uninstall: theme "${id}" is not installed`)
    }
    store.removeTheme(id)
    return { id, removed: true }
  },
}

export const THEME_BUILTIN_CAPABILITIES: readonly Command[] = [
  themeListCapability,
  themeReadCapability,
  themeApplyCapability,
  themeCreateCapability,
  themeUpdateCapability,
  themeInstallCapability,
  themeUninstallCapability,
  themeHistoryCapability,
  themeRevertCapability,
]
