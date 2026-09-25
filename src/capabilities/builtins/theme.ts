import type { Command } from '@/commands/registry'
import { useThemeStore } from '@/stores/theme'
import { implement, implementCore } from '../declare'

/**
 * `theme.list` — インストール済みテーマの一覧を返す。
 * AI が `theme.apply` で渡す ID を確認するために使う。
 */
export const themeListCapability = implementCore('theme.list')

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
export const themeReadCapability = implementCore('theme.read')

export const themeApplyCapability = implement('theme.apply', {
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
})

/**
 * `theme.create` — 新規テーマを installedThemes に追加する。
 * AI が「ユーザーの好みに合わせて配色提案」「メモのトーンに合わせた季節テーマ」
 * のように動的にテーマを作るための capability。frontmatter 相当の id は
 * 衝突しないよう自動生成 (`custom-<timestamp>`) でも、明示指定でも OK。
 */
export const themeCreateCapability = implementCore('theme.create')

/**
 * `theme.update` — 既存テーマの props / name / base を部分更新する。
 * 内部的には installTheme (= upsert) を呼ぶので、id 不一致なら新規扱いに
 * ならないよう execute 側で必ず id 存在チェックを行う。
 */
export const themeUpdateCapability = implementCore('theme.update')

export const themeHistoryCapability = implementCore('theme.history')

export const themeRevertCapability = implementCore('theme.revert')

/**
 * `theme.install` — MisStore (store.notedeck.io) から既製テーマを取得して
 * installedThemes に追加する。AI が「ダークなら Dracula が定番」のように
 * 推薦して install まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installTheme(entry, forAccountIds)` を呼ぶだけ。
 * sha512 検証・$notedeck.storeId 紐付け・既存 installedFor の union は
 * misstore store 側で実装済。
 */
export const themeInstallCapability = implementCore('theme.install')

/**
 * `theme.uninstall` — インストール済みテーマを完全削除する。
 * cross-account (Global) からの除去と同等で、ファイル・selection・
 * applyCurrentTheme まで連動する。per-account 紐付けの解除は別途
 * 設計が必要なため、ここではシンプルに「完全削除」に統一する。
 */
export const themeUninstallCapability = implementCore('theme.uninstall')

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
