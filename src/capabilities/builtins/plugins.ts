import { launchPlugin, parsePluginMeta } from '@/aiscript/plugin-api'
import type { Command } from '@/commands/registry'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { implement, implementCore } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'
import { preflightValidateSrc } from './aiscript'

/**
 * Plugin 系 capability — AI が AiScript プラグインを動的に作成・編集・有効化・
 * 削除できる (= 「自己拡張する IDE」PR-D、memory:
 * project_self_extending_ide_roadmap.md)。skills / widgets / themes と同様に
 * 全 write capability を `aiTool: true` で開放し、各 `requiresConfirmation` の
 * 関数版で MisStore カード風の install preview を出してユーザー承認を取る。
 *
 * 安全策:
 * - `create` は常に `active: false` で作成 (widget の `autoRun: false` default
 *   と同じ思想)。handler 起動は `setActive(true)` での明示承認 (= 二重承認)。
 * - `setActive(true)` (有効化) は confirm で permissions を表示。
 *   `setActive(false)` (無効化) は handler 停止のみで confirm スキップ。
 * - `delete` / `revert` は確認ダイアログで対象情報 / 戻し先 snapshot を表示。
 *
 * 読取系 (list / read / history) も `aiTool: true`。
 */

export const pluginsListCapability = implementCore('plugins.list')

export const pluginsReadCapability = implementCore('plugins.read')

export const pluginsCreateCapability = implement('plugins.create', {
  preflight: (params) => preflightValidateSrc(params, 'plugin'),
  requiresConfirmation: (params) => ({
    title: 'プラグインをインストール',
    message:
      'AI が生成したプラグインをインストールします。作成直後は無効化された' +
      '状態なので、有効化はプラグインカラムから手動で行ってください。',
    installPreview: {
      kind: 'plugin',
      name: typeof params?.name === 'string' ? params.name : '',
      version:
        typeof params?.version === 'string' && params.version.length > 0
          ? params.version
          : '1.0.0',
      author: typeof params?.author === 'string' ? params.author : undefined,
      description:
        typeof params?.description === 'string'
          ? params.description
          : undefined,
      permissions: isStringArray(params?.permissions) ? params.permissions : [],
    },
    code: typeof params?.src === 'string' ? params.src : '',
    codeLanguage: 'is',
    okLabel: 'インストール',
    cancelLabel: 'やめる',
    type: 'normal',
  }),
  execute: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!name) throw new Error('plugins.create: name is required')
    if (!src) throw new Error('plugins.create: src is required')
    const version =
      typeof params?.version === 'string' && params.version.length > 0
        ? params.version
        : '1.0.0'
    const author =
      typeof params?.author === 'string' ? params.author : undefined
    const description =
      typeof params?.description === 'string' ? params.description : undefined
    const permissions = isStringArray(params?.permissions)
      ? params.permissions
      : undefined
    const installId = `nd-plugin-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
    const plugin: PluginMeta = {
      installId,
      name,
      version,
      author,
      description,
      permissions,
      configData: {},
      src,
      active: false,
      // AI 経由はカラム文脈を持たないため全体スコープで作成 (#771)
      global: true,
    }
    const store = usePluginsStore()
    store.addPlugin(plugin)
    return { installId, name, active: false }
  },
})

export const pluginsUpdateCapability = implement('plugins.update', {
  preflight: (params) => preflightValidateSrc(params, 'plugin'),
  requiresConfirmation: (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur) return null
    stageEdit(ctx, cur.src, src)
    const newMeta = parsePluginMeta(src)
    return {
      title: 'プラグインを更新',
      message:
        `${cur.name} の AiScript を ${cur.src.length} → ${src.length} 文字に置換します。` +
        (cur.active
          ? 'アクティブなため、保存後すぐ新しいコードで再起動されます。'
          : ''),
      installPreview: {
        kind: 'plugin',
        name: newMeta?.name ?? cur.name,
        version: newMeta?.version ?? cur.version,
        author: newMeta?.author ?? cur.author,
        description: newMeta?.description ?? cur.description,
        permissions: newMeta?.permissions ?? cur.permissions ?? [],
      },
      diff: { old: cur.src, new: src, language: 'aiscript' },
      okLabel: '更新',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!installId) throw new Error('plugins.update: installId is required')
    if (!src) throw new Error('plugins.update: src is required')
    const store = usePluginsStore()
    const cur = store.getPlugin(installId)
    if (!cur) {
      throw new Error(`plugins.update: plugin "${installId}" not found`)
    }
    const next = takeStagedEdit(ctx, 'plugins.update', cur.src, () => src)
    store.updateSrc(installId, next, editAttribution(ctx, params))
    // アクティブなら UI の保存と同様に新 src で再起動する (#744)。
    // launchPlugin は内部で既存インスタンスを abort する。
    const updated = store.getPlugin(installId)
    let relaunched = false
    if (updated?.active) {
      await launchPlugin(updated)
      relaunched = true
    }
    return { installId, length: next.length, relaunched }
  },
})

export const pluginsSetActiveCapability = implementCore('plugins.setActive')

export const pluginsDeleteCapability = implementCore('plugins.delete')

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export const pluginsHistoryCapability = implementCore('plugins.history')

export const pluginsRevertCapability = implementCore('plugins.revert')

/**
 * `plugins.install` — MisStore (store.notedeck.io) から既製プラグインを取得して
 * plugins store に追加する。AI が「○○の機能ない？」のように推薦から install
 * まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installPlugin(entry, scope)` を呼ぶだけ。
 * sha512 検証・parsePluginMeta・既存 storeId へのスコープ追加は misstore
 * store 側で実装済 (= 同 storeId のプラグインがあれば再インストールせず
 * scope 参照を追加するだけ)。AI 経由はカラム文脈を持たないため全体スコープ
 * (全アカウント対象、後から追加した分も含む #771) で入れる。インストール後は
 * active=true で自動起動される (misstore.ts installPlugin の挙動)。
 */
export const pluginsInstallCapability = implementCore('plugins.install')

/**
 * `plugins.uninstall` — インストール済みプラグインを完全削除する。
 * `plugins.delete` と同等動作だが、命名を MisStore install/uninstall 対称形に
 * 揃え、storeId からも引けるエイリアス。AI が「MisStore で入れた○○外して」
 * と発話したとき id ベースで消せるよう、両方を受け付ける。
 */
export const pluginsUninstallCapability = implementCore('plugins.uninstall')

export const PLUGINS_BUILTIN_CAPABILITIES: readonly Command[] = [
  pluginsListCapability,
  pluginsReadCapability,
  pluginsCreateCapability,
  pluginsUpdateCapability,
  pluginsSetActiveCapability,
  pluginsDeleteCapability,
  pluginsInstallCapability,
  pluginsUninstallCapability,
  pluginsHistoryCapability,
  pluginsRevertCapability,
]
