import type { Command } from '@/commands/registry'
import { i18n } from '@/i18n'
import {
  generateWidgetId,
  useWidgetsStore,
  type WidgetMeta,
} from '@/stores/widgets'
import { implement, implementCore } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'
import { preflightValidateSrc } from './aiscript'

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

export const widgetsListCapability = implementCore('widgets.list')

export const widgetsReadCapability = implementCore('widgets.read')

export const widgetsCreateCapability = implement('widgets.create', {
  preflight: (params) => preflightValidateSrc(params, 'widget'),
  requiresConfirmation: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const autoRun = params?.autoRun === true
    return {
      title: i18n.ts._widgetsCapability.createTitle,
      message: autoRun
        ? i18n.ts._widgetsCapability.createMessageAutoRun
        : i18n.ts._widgetsCapability.createMessageManual,
      installPreview: {
        kind: 'widget',
        name,
      },
      code: src,
      codeLanguage: 'is',
      okLabel: i18n.ts._common.install,
      cancelLabel: i18n.ts._common.cancel,
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
      title: i18n.ts._widgetsCapability.updateTitle,
      message: (useWidgetsStore().mountedCount(installId) > 0
        ? i18n.tsx._widgetsCapability.updateMessageMounted
        : i18n.tsx._widgetsCapability.updateMessage)({
        name: cur.name,
        from: cur.src.length,
        to: src.length,
      }),
      installPreview: {
        kind: 'widget',
        name: cur.name,
      },
      diff: { old: cur.src, new: src, language: 'aiscript' },
      okLabel: i18n.ts._common.update,
      cancelLabel: i18n.ts._common.cancel,
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

export const widgetsSetAutoRunCapability = implementCore('widgets.setAutoRun')

export const widgetsDeleteCapability = implementCore('widgets.delete')

export const widgetsHistoryCapability = implementCore('widgets.history')

export const widgetsRevertCapability = implementCore('widgets.revert')

/**
 * `widgets.install` — MisStore (store.notedeck.io) から既製ウィジェットを取得して
 * widgets store に追加する。AI が「天気 widget が欲しい」のように推薦から
 * install まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installWidget(entry)` を呼ぶだけ。
 * sha512 検証・同 storeId の重複インストール抑止は misstore store 側で実装済。
 * カラムへの attach はしない (= 「とりあえず手元に入れる」が capability の責務)。
 */
export const widgetsInstallCapability = implementCore('widgets.install')

/**
 * `widgets.uninstall` — インストール済みウィジェットを完全削除する。
 * `widgets.delete` と同等動作だが、命名を MisStore install/uninstall 対称形に
 * 揃えるためのエイリアス。AI が「入れて」「外して」と自然言語で発話したとき
 * id ベースでも installId ベースでも理解できるよう、両方を受け付ける。
 */
export const widgetsUninstallCapability = implementCore('widgets.uninstall')

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
