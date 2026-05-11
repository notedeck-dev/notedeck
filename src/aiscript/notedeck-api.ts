import type { Interpreter } from '@syuilo/aiscript'
import { utils, values } from '@syuilo/aiscript'
import type { Value, VFn } from '@syuilo/aiscript/interpreter/value.js'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { listCapabilities } from '@/capabilities/registry'
import type { CapabilitySignature, PermissionKey } from '@/capabilities/types'
import type { Command, useCommandStore } from '@/commands/registry'
import type { AiConfig } from '@/composables/useAiConfig'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { version as appVersion } from '../../package.json'
import {
  type NoteDeckEventName,
  SUPPORTED_EVENT_NAMES,
  subscribeNoteDeckEvent,
  type Unsubscribe,
} from './events'

export interface NoteDeckEnvContext {
  commandStore: ReturnType<typeof useCommandStore>
  /**
   * Nd:call が permissions / requiresConfirmation を解決するときに使う
   * AI 設定。呼び出し時点で最新値が必要なため値ではなく getter で受け取る。
   * Phase 1 では AI チャットの設定と同じものを流用する (= プラグインは
   * AI と同じ allow/deny で縛られる)。Phase 2 でプラグイン専用 permissions
   * に分離する余地がある。
   */
  getAiConfig: () => AiConfig
  /** Set after interpreter is created, enables Nd:register_command handlers */
  interpreter?: Interpreter
  /** Track registered command IDs for cleanup */
  registeredCommandIds: string[]
  /** Active Nd:on subscriptions; auto-disposed by cleanupNoteDeckEnv */
  subscriptions: Unsubscribe[]
}

export function createNoteDeckEnv(
  ctx: NoteDeckEnvContext,
): Record<string, Value> {
  const { commandStore } = ctx
  const consts: Record<string, Value> = {}

  // --- Feature detection ---
  consts.NOTEDECK = values.TRUE
  consts['Nd:version'] = values.STR(appVersion)

  // --- Nd:call ---
  // capability registry に登録されている任意の capability を呼び出す。
  // permissions / requiresConfirmation は dispatcher が処理するため、
  // ここでは結果の包み替えとエラー throw のみ行う。
  consts['Nd:call'] = values.FN_NATIVE(async ([idVal, paramsVal]) => {
    utils.assertString(idVal)
    const params =
      paramsVal?.type === 'obj'
        ? (utils.valToJs(paramsVal) as Record<string, unknown>)
        : undefined
    const result = await dispatchCapability(
      idVal.value,
      params,
      ctx.getAiConfig(),
    )
    if (!result.ok) {
      throw new Error(
        `Nd:call ${idVal.value} (${result.code}): ${result.error}`,
      )
    }
    return utils.jsToVal(result.result)
  })

  // --- Nd:capabilities ---
  // registry にある capability の宣言情報を配列で返す。プラグインが
  // 「使える capability の一覧」を自己発見できるため、Nd:* のドキュメントを
  // 別管理する必要がない。
  consts['Nd:capabilities'] = values.FN_NATIVE(() => {
    return utils.jsToVal(
      listCapabilities().map((c) => ({
        id: c.id,
        label: c.label,
        description: c.signature?.description ?? '',
        params: c.signature?.params ?? {},
        returns: c.signature?.returns ?? null,
        permissions: c.permissions ?? [],
        requiresConfirmation: c.requiresConfirmation === true,
      })),
    )
  })

  // --- Nd:http ---
  // 外部 HTTP API (CORS なし) を叩く。Rust 側で SSRF 防御 / size limit /
  // timeout を通すため、フロントは薄い invoke ラッパに留める。
  //
  // `Nd:call('http.fetch', { url, ... })` でも同じ実装を呼べる
  // (capabilities/builtins/http.ts に登録)。permissions: ['network.external']。
  consts['Nd:http'] = values.FN_NATIVE(async ([urlVal, optionsVal]) => {
    utils.assertString(urlVal)
    const options =
      optionsVal?.type === 'obj'
        ? (utils.valToJs(optionsVal) as Record<string, unknown>)
        : {}
    const request = {
      url: urlVal.value,
      method: typeof options.method === 'string' ? options.method : null,
      headers: isStringRecord(options.headers) ? options.headers : null,
      body: typeof options.body === 'string' ? options.body : null,
      timeoutMs:
        typeof options.timeoutMs === 'number' ? options.timeoutMs : null,
    }
    const response = unwrap(await commands.httpFetch(request))
    return utils.jsToVal({
      status: response.status,
      headers: response.headers,
      body: response.body,
    })
  })

  // --- Nd:on ---
  // NoteDeck 内部イベントの購読。AiScript ハンドラに整形済 payload を渡す。
  // 戻り値は AiScript の関数で、呼ぶと unsubscribe される。
  // プラグイン終了時には cleanupNoteDeckEnv が全 subscription を一括解除する
  // ので、ユーザーは unsubscribe を明示的に呼ばなくても安全。
  consts['Nd:on'] = values.FN_NATIVE(([nameVal, handlerVal]) => {
    utils.assertString(nameVal)
    utils.assertFunction(handlerVal)
    const eventName = nameVal.value
    if (!isSupportedEvent(eventName)) {
      throw new Error(
        `Nd:on: unsupported event "${eventName}". ` +
          `Supported: ${SUPPORTED_EVENT_NAMES.join(', ')}`,
      )
    }
    const handler = handlerVal as VFn
    const unsubscribe = subscribeNoteDeckEvent(eventName, (payload) => {
      const interp = ctx.interpreter
      if (!interp) return
      try {
        interp.execFn(handler, [utils.jsToVal(payload)])
      } catch (e) {
        console.warn('[Nd:on]', eventName, e)
      }
    })
    ctx.subscriptions.push(unsubscribe)

    // AiScript 側に返す unsubscribe 関数
    return values.FN_NATIVE(() => {
      unsubscribe()
      const idx = ctx.subscriptions.indexOf(unsubscribe)
      if (idx >= 0) ctx.subscriptions.splice(idx, 1)
    })
  })

  // --- Nd:register_command ---
  // 5 引数目の `options` を渡すと capability registry にもミラー登録され、
  // AI tool calling / HTTP API / CLI からも呼べるようになる。
  // options なし = 従来通り UI コマンドパレット専用。
  //
  // カラム操作 (旧 Nd:columns / Nd:addColumn / Nd:removeColumn) は
  // `Nd:call('column.list')` / `Nd:call('column.add', ...)` /
  // `Nd:call('column.remove', ...)` で代替する (capability registry 経由)。
  consts['Nd:register_command'] = values.FN_NATIVE(
    ([idVal, labelVal, iconVal, handlerVal, optionsVal]) => {
      utils.assertString(idVal)
      utils.assertString(labelVal)
      utils.assertString(iconVal)
      utils.assertFunction(handlerVal)

      const parsed = parseRegisterCommandOptions(optionsVal)
      const commandId = `nd-plugin:${idVal.value}`
      const handler = handlerVal as VFn
      const command: Command = {
        id: commandId,
        label: labelVal.value,
        icon: iconVal.value,
        category: 'general',
        shortcuts: [],
        execute: (params) => {
          const interp = ctx.interpreter
          if (!interp) {
            console.warn('[Nd:register_command] interpreter not available')
            return
          }
          try {
            // params あり (= dispatcher / AI tool 経由) は戻り値を返す必要があるため
            // 同期実行 + JS 値変換。params なし (= UI コマンドパレット経由) は
            // 戻り値不要なので fire-and-forget。
            if (params && Object.keys(params).length > 0) {
              const result = interp.execFnSync(handler, [utils.jsToVal(params)])
              return utils.valToJs(result)
            }
            interp.execFn(handler, [])
          } catch (e) {
            console.warn('[Nd:register_command]', e)
            throw e
          }
        },
      }
      if (parsed.aiTool) command.aiTool = true
      if (parsed.permissions) command.permissions = parsed.permissions
      if (parsed.requiresConfirmation !== undefined) {
        command.requiresConfirmation = parsed.requiresConfirmation
      }
      if (parsed.signature) command.signature = parsed.signature

      commandStore.register(command)
      ctx.registeredCommandIds.push(commandId)
    },
  )

  return consts
}

/**
 * Cleanup NoteDeck API resources (unregister commands, unsubscribe events).
 * プラグイン abort / カラム破棄 / interpreter 再起動時に呼ばれる。
 */
export function cleanupNoteDeckEnv(ctx: NoteDeckEnvContext): void {
  for (const id of ctx.registeredCommandIds) {
    ctx.commandStore.unregister(id)
  }
  ctx.registeredCommandIds.length = 0
  for (const unsub of ctx.subscriptions) {
    try {
      unsub()
    } catch (e) {
      console.warn('[cleanupNoteDeckEnv] unsubscribe failed:', e)
    }
  }
  ctx.subscriptions.length = 0
}

function isSupportedEvent(name: string): name is NoteDeckEventName {
  return (SUPPORTED_EVENT_NAMES as readonly string[]).includes(name)
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== 'string') return false
  }
  return true
}

interface ParsedRegisterCommandOptions {
  aiTool: boolean
  permissions?: PermissionKey[]
  requiresConfirmation?: boolean
  signature?: CapabilitySignature
}

/**
 * `Nd:register_command` の 5 引数目を解析する。AiScript の obj 値から
 * Command 用フィールドを取り出す。未知フィールドは無視する。
 */
function parseRegisterCommandOptions(
  optionsVal: Value | undefined,
): ParsedRegisterCommandOptions {
  const out: ParsedRegisterCommandOptions = { aiTool: false }
  if (!optionsVal || optionsVal.type !== 'obj') return out

  const options = utils.valToJs(optionsVal) as Record<string, unknown>
  if (options.aiTool === true) out.aiTool = true
  if (Array.isArray(options.permissions)) {
    out.permissions = options.permissions.filter(
      (p): p is string => typeof p === 'string',
    ) as PermissionKey[]
  }
  if (typeof options.requiresConfirmation === 'boolean') {
    out.requiresConfirmation = options.requiresConfirmation
  }
  if (
    options.signature &&
    typeof options.signature === 'object' &&
    !Array.isArray(options.signature)
  ) {
    const sig = options.signature as Record<string, unknown>
    const signature: CapabilitySignature = {
      description: typeof sig.description === 'string' ? sig.description : '',
    }
    if (sig.params && typeof sig.params === 'object') {
      signature.params = sig.params as CapabilitySignature['params']
    }
    if (sig.returns && typeof sig.returns === 'object') {
      signature.returns = sig.returns as CapabilitySignature['returns']
    }
    if (typeof sig.cheap === 'boolean') signature.cheap = sig.cheap
    out.signature = signature
  }
  return out
}
