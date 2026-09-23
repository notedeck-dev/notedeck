import type { Command } from '@/commands/registry'
import { listWidgetInstances } from '@/services/widgetInstances'
import {
  accountScopeKey,
  findAccountByScopeKey,
  useAccountsStore,
} from '@/stores/accounts'
import { useMisStoreStore } from '@/stores/misstore'
import {
  generateWidgetId,
  useWidgetsStore,
  type WidgetMeta,
} from '@/stores/widgets'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'
import { pickAccountId } from '../accountContext'
import { implement } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'
import { preflightValidateSrc } from './aiscript'

interface WidgetSnapshot {
  src: string
  name?: string
  autoRun?: boolean
}

/**
 * Widget 系 capability — AI が AiScript ウィジェットを動的に作成・編集
 * できるようにする (= 「自己拡張する IDE」PR-C、memory:
 * project_self_extending_ide_roadmap.md)。
 *
 * ウィジェットは AiScript ソース + メタの 2 つで構成され (memory:
 * project_widgets_local_aiscript.md)、`autoRun: true` ならカラム表示時に
 * 自動実行される。AI が「ユーザーの好みに合わせた小道具」を提案できる。
 *
 * セキュリティ:
 * - 編集系は全て `requiresConfirmation: true` (= AI が任意のコードを
 *   ユーザー知らない間に作るのを防ぐ)
 * - AiScript の Mk:* / Nd:* permission は実行時に別途 plugin/widget の
 *   permission system が enforce する (= ここでは「ウィジェットを作る権限」
 *   のみ管理、ウィジェット内部の動作は別レイヤー)
 */

export const widgetsListCapability = implement('widgets.list', {
  execute: () => {
    const store = useWidgetsStore()
    const accounts = useAccountsStore().accounts
    return store.widgets.map((w) => ({
      installId: w.installId,
      name: w.name,
      autoRun: w.autoRun,
      storeId: w.storeId ?? null,
      accountId: w.accountKey
        ? (findAccountByScopeKey(accounts, w.accountKey)?.id ?? null)
        : null,
      updatedAt: w.updatedAt,
    }))
  },
})

export const widgetsReadCapability = implement('widgets.read', {
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('widgets.read: installId is required')
    const store = useWidgetsStore()
    const widget = store.getWidget(installId)
    if (!widget) {
      throw new Error(`widgets.read: widget "${installId}" not found`)
    }
    return {
      installId: widget.installId,
      name: widget.name,
      src: widget.src,
      autoRun: widget.autoRun,
    }
  },
})

export const widgetsCreateCapability = implement('widgets.create', {
  preflight: (params) => preflightValidateSrc(params, 'widget'),
  requiresConfirmation: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const autoRun = params?.autoRun === true
    return {
      title: 'ウィジェットをインストール',
      message: autoRun
        ? 'AI が生成したウィジェットをインストールします。カラム表示時に自動実行されます。'
        : 'AI が生成したウィジェットをインストールします。自動実行は無効です (= 手動で起動)。',
      installPreview: {
        kind: 'widget',
        name,
      },
      code: src,
      codeLanguage: 'is',
      okLabel: 'インストール',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const autoRun = params?.autoRun === true
    if (!name) throw new Error('widgets.create: name is required')
    if (!src) throw new Error('widgets.create: src is required')
    const now = Date.now()
    const widget: WidgetMeta = {
      installId: generateWidgetId(),
      name,
      src,
      autoRun,
      createdAt: now,
      updatedAt: now,
    }
    const store = useWidgetsStore()
    store.addWidget(widget)
    return {
      installId: widget.installId,
      name: widget.name,
      autoRun: widget.autoRun,
    }
  },
})

export const widgetsUpdateCapability = implement('widgets.update', {
  preflight: (params) => preflightValidateSrc(params, 'widget'),
  requiresConfirmation: (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const cur = useWidgetsStore().getWidget(installId)
    if (!cur) return null
    stageEdit(ctx, cur.src, src)
    return {
      title: 'ウィジェットを更新',
      message:
        `${cur.name} の AiScript を ${cur.src.length} → ${src.length} 文字に置換します。` +
        (useWidgetsStore().mountedCount(installId) > 0
          ? '表示中のウィジェットは保存後すぐ新しいコードで再実行されます。'
          : ''),
      installPreview: {
        kind: 'widget',
        name: cur.name,
      },
      diff: { old: cur.src, new: src, language: 'aiscript' },
      okLabel: '更新',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!installId) throw new Error('widgets.update: installId is required')
    if (!src) throw new Error('widgets.update: src is required')
    const store = useWidgetsStore()
    const cur = store.getWidget(installId)
    if (!cur) {
      throw new Error(`widgets.update: widget "${installId}" not found`)
    }
    const next = takeStagedEdit(ctx, 'widgets.update', cur.src, () => src)
    store.updateSrc(installId, next, editAttribution(ctx, params))
    // 表示中のインスタンスに再実行を要求する (#744)。ユーザーのエディタ編集
    // (debounce 自動保存) と違い、AI 経由の保存だけがこのシグナルを発火する。
    const rerunning = store.requestRerun(installId) > 0
    return { installId, length: next.length, rerunning }
  },
})

export const widgetsSetAutoRunCapability = implement('widgets.setAutoRun', {
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) {
      throw new Error('widgets.setAutoRun: installId is required')
    }
    const autoRun = params?.autoRun === true
    const store = useWidgetsStore()
    if (!store.getWidget(installId)) {
      throw new Error(`widgets.setAutoRun: widget "${installId}" not found`)
    }
    store.setAutoRun(installId, autoRun)
    return { installId, autoRun }
  },
})

export const widgetsDeleteCapability = implement('widgets.delete', {
  requiresConfirmation: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const cur = useWidgetsStore().getWidget(installId)
    if (!cur) return null
    return {
      title: 'ウィジェットを削除',
      message:
        `${cur.name} を削除します。AiScript ソース・メタ・` +
        'Mk:save 領域がすべて消えます (= 不可逆)。',
      installPreview: {
        kind: 'widget',
        name: cur.name,
      },
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('widgets.delete: installId is required')
    const store = useWidgetsStore()
    const existed = !!store.getWidget(installId)
    store.removeWidget(installId)
    return { installId, removed: existed }
  },
})

export const widgetsHistoryCapability = implement('widgets.history', {
  execute: async (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('widgets.history: installId is required')
    const store = useWidgetsStore()
    const widget = store.getWidget(installId)
    if (!widget) {
      throw new Error(`widgets.history: widget "${installId}" not found`)
    }
    const basename = widget.fileBase ?? (widget.name || widget.installId)
    return await listSnapshots<WidgetSnapshot>('widget', basename)
  },
})

export const widgetsRevertCapability = implement('widgets.revert', {
  requiresConfirmation: async (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    const cur = useWidgetsStore().getWidget(installId)
    if (!cur || index < 0) return null
    const basename = cur.fileBase ?? (cur.name || cur.installId)
    const entry = await getSnapshotAt<WidgetSnapshot>('widget', basename, index)
    if (!entry) return null
    const next = stageEdit(ctx, cur.src, entry.snapshot.src)
    return {
      title: 'ウィジェットを過去の状態に戻す',
      message:
        `${cur.name} を編集履歴 #${index} (${new Date(entry.at).toLocaleString()}) ` +
        'の状態に戻します。現在の AiScript ソースは上書きされます。',
      installPreview: {
        kind: 'widget',
        name: entry.snapshot.name ?? cur.name,
      },
      diff: { old: cur.src, new: next, language: 'aiscript' },
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!installId) throw new Error('widgets.revert: installId is required')
    if (index < 0) throw new Error('widgets.revert: index must be >= 0')
    const store = useWidgetsStore()
    const widget = store.getWidget(installId)
    if (!widget) {
      throw new Error(`widgets.revert: widget "${installId}" not found`)
    }
    const basename = widget.fileBase ?? (widget.name || widget.installId)
    const entry = await getSnapshotAt<WidgetSnapshot>('widget', basename, index)
    if (!entry) {
      throw new Error(`widgets.revert: no snapshot at index ${index}`)
    }
    const next = takeStagedEdit(
      ctx,
      'widgets.revert',
      widget.src,
      () => entry.snapshot.src,
    )
    store.updateSrc(installId, next, editAttribution(ctx, params))
    return { installId, reverted: true, at: entry.at }
  },
})

/**
 * `widgets.install` — MisStore (store.notedeck.io) から既製ウィジェットを取得して
 * widgets store に追加する。AI が「天気 widget が欲しい」のように推薦から
 * install まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installWidget(entry)` を呼ぶだけ。
 * sha512 検証・同 storeId の重複インストール抑止は misstore store 側で実装済。
 * カラムへの attach はしない (= 「とりあえず手元に入れる」が capability の責務)。
 */
export const widgetsInstallCapability = implement('widgets.install', {
  requiresConfirmation: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const misStore = useMisStoreStore()
    await misStore.fetchWidgets()
    const entry = misStore.widgets.find((w) => w.id === id)
    if (!entry) return null
    return {
      title: 'MisStore からウィジェットを入れる',
      message:
        `${entry.name} (v${entry.version} / by ${entry.author}) を MisStore から取得します。` +
        (entry.autoRun
          ? ' カラム表示時に自動実行されます。'
          : ' 自動実行は無効です (= 手動で起動)。'),
      installPreview: {
        kind: 'widget',
        name: entry.name,
        version: entry.version,
        author: entry.author,
        description: entry.description,
      },
      code: entry.description,
      codeLanguage: 'plaintext',
      okLabel: 'インストール',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('widgets.install: id is required')
    // 実行アカウントは安定キーで持つ (#1061)。存在しない指定は fetch 前に弾く
    const accountId = pickAccountId(params?.accountId)
    let accountKey: string | undefined
    if (accountId) {
      const account = useAccountsStore().accountMap.get(accountId)
      if (!account) {
        throw new Error(`widgets.install: account "${accountId}" not found`)
      }
      accountKey = accountScopeKey(account)
    }
    const misStore = useMisStoreStore()
    await misStore.fetchWidgets()
    const entry = misStore.widgets.find((w) => w.id === id)
    if (!entry) {
      throw new Error(
        `widgets.install: widget "${id}" not found in MisStore (try misstore.search first)`,
      )
    }
    const widget = await misStore.installWidget(entry, accountKey)
    return {
      installId: widget.installId,
      name: widget.name,
      autoRun: widget.autoRun,
      installed: true,
    }
  },
})

/**
 * `widgets.uninstall` — インストール済みウィジェットを完全削除する。
 * `widgets.delete` と同等動作だが、命名を MisStore install/uninstall 対称形に
 * 揃えるためのエイリアス。AI が「入れて」「外して」と自然言語で発話したとき
 * id ベースでも installId ベースでも理解できるよう、両方を受け付ける。
 */
export const widgetsUninstallCapability = implement('widgets.uninstall', {
  requiresConfirmation: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const storeId = typeof params?.storeId === 'string' ? params.storeId : ''
    const widgetsStore = useWidgetsStore()
    const targets = installId
      ? [widgetsStore.getWidget(installId)].filter((w) => w !== undefined)
      : listWidgetInstances(widgetsStore.widgets, storeId)
    const cur = targets[0]
    if (!cur) return null
    // storeId 指定は実行アカウント別の全個体が対象 (#1061)
    const others = targets.length > 1 ? ` ほか ${targets.length - 1} 件` : ''
    return {
      title: 'ウィジェットを削除',
      message:
        `${cur.name}${others} を削除します。AiScript ソース・メタ・Mk:save 領域が` +
        'すべて消えます (= 不可逆)。',
      installPreview: {
        kind: 'widget',
        name: cur.name,
      },
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const storeId = typeof params?.storeId === 'string' ? params.storeId : ''
    if (!installId && !storeId) {
      throw new Error('widgets.uninstall: installId or storeId is required')
    }
    const store = useWidgetsStore()
    const targets = installId
      ? [store.getWidget(installId)].filter((w) => w !== undefined)
      : listWidgetInstances(store.widgets, storeId)
    const first = targets[0]
    if (!first) {
      throw new Error(
        `widgets.uninstall: widget not found (installId="${installId}" storeId="${storeId}")`,
      )
    }
    for (const w of targets) store.removeWidget(w.installId)
    return {
      installId: first.installId,
      installIds: targets.map((w) => w.installId),
      removed: true,
    }
  },
})

export const WIDGETS_BUILTIN_CAPABILITIES: readonly Command[] = [
  widgetsListCapability,
  widgetsReadCapability,
  widgetsCreateCapability,
  widgetsUpdateCapability,
  widgetsInstallCapability,
  widgetsUninstallCapability,
  widgetsSetAutoRunCapability,
  widgetsDeleteCapability,
  widgetsHistoryCapability,
  widgetsRevertCapability,
]
