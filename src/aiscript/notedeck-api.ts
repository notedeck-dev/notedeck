import type { Interpreter } from '@syuilo/aiscript'
import { utils, values } from '@syuilo/aiscript'
import type { Value, VFn } from '@syuilo/aiscript/interpreter/value.js'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { listCapabilities } from '@/capabilities/registry'
import type { CapabilitySignature, PermissionKey } from '@/capabilities/types'
import type { Command, useCommandStore } from '@/commands/registry'
import type { Principal } from '@/permissions/principal'
import { makeRegistrationId } from '@/plugins/registrationId'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { version as appVersion } from '../../package.json'
import {
  type NoteDeckEventName,
  SUPPORTED_EVENT_NAMES,
  subscribeNoteDeckEvent,
} from './events'

export interface NoteDeckEnvContext {
  commandStore: ReturnType<typeof useCommandStore>
  /**
   * この env で動くコードの principal (#712 §5.5)。プラグイン / ウィジェット /
   * Play / Page は `{ kind: 'plugin', pluginId }` (pluginId は必須 populate —
   * ウィジェットは `widget:<id>`、Play は `play:<id>` 等)。playground
   * (本人がその場で書いて実行するコード) は `{ kind: 'user' }`。
   * populate できない実行文脈は plugin principal を名乗れない (型で強制)。
   */
  principal: Principal
  /**
   * 登録アイテムの名前空間になるプラグイン安定キー (#794 未決事項 2)。
   * `pluginProviderKey` の戻り値 — MisStore 配布物は storeId、ローカル自作は
   * `local:<installId>`。全登録 ID がこの下に切られるので、プラグイン同士が
   * 名前で衝突しない。
   */
  provider: string
  /** Set after interpreter is created, enables Nd:register_command handlers */
  interpreter?: Interpreter
  /**
   * この env が行った全登録の解除関数 (#794 原則 5)。
   *
   * 「プラグインからの登録は必ずコンテキスト経由で行い、停止時に一括解除される」
   * を単一の配列で表現する。登録面ごとに配列を増やす方式だと、開放面が 1 つ
   * 増えるたび cleanup 側にも 1 行足す必要があり、#794 が解こうとしている
   * まだら化を解除側で再発させる。
   */
  disposers: Array<() => void>
  /**
   * 呼び出し文脈のアカウントを返すアクセサ (#821)。プラグインは
   * withPluginAccountContext が設定するミュータブル文脈を読むため関数。
   * widget / Play / Page はホスト元アカウント固定のクロージャ。
   * 未指定 = アカウント文脈なし (Nd:call は accountId を渡さない)。
   */
  getAccountId?: () => string | null
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
  //
  // principal は env 構築時に確定した ctx.principal (#712 §3.5)。plugin コード
  // からの Nd:call は起動経路 (AI tool 経由か自律か) に関係なく常に plugin
  // プロファイル単独で resolve される — その write を許すかは権限設定の
  // plugin 行に対するユーザーの同意が正本。
  consts['Nd:call'] = values.FN_NATIVE(async ([idVal, paramsVal]) => {
    utils.assertString(idVal)
    const params =
      paramsVal?.type === 'obj'
        ? (utils.valToJs(paramsVal) as Record<string, unknown>)
        : undefined
    const result = await dispatchCapability(idVal.value, params, {
      principal: ctx.principal,
      accountId: ctx.getAccountId?.() ?? null,
    })
    if (!result.ok) {
      // 確認ダイアログのキャンセルはユーザーの正常な操作 (#1074)。AiScript に
      // try/catch は無く、throw するとプラグイン側で握り潰せないため、本家
      // Mk:api の失敗時と同じく error 値で返す (Core:type(r) == "error")
      if (result.code === 'user_cancelled') {
        return values.ERROR('user_cancelled', values.STR(result.error))
      }
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
  // timeout を通す。
  //
  // #712 §5.5 / #711: plugin 文脈では `http.fetch` capability (= dispatcher)
  // への薄い alias — plugin プロファイルの `network.external` gate + 確認
  // ダイアログ + Spotlight が効く。従来の直 invoke はプラグイン設定値に
  // 入れた secret の無 gate 送出経路 (exfiltration) だった。
  // user 文脈 (playground) は本人の操作なので従来どおり直接 invoke (挙動不変)。
  // AiScript 側の引数 / 戻り値の形は両経路で同一。
  consts['Nd:http'] = values.FN_NATIVE(async ([urlVal, optionsVal]) => {
    utils.assertString(urlVal)
    const options =
      optionsVal?.type === 'obj'
        ? (utils.valToJs(optionsVal) as Record<string, unknown>)
        : {}
    if (ctx.principal.kind === 'user') {
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
    }
    const params: Record<string, unknown> = { url: urlVal.value }
    if (typeof options.method === 'string') params.method = options.method
    if (isStringRecord(options.headers)) params.headers = options.headers
    if (typeof options.body === 'string') params.body = options.body
    if (typeof options.timeoutMs === 'number') {
      params.timeoutMs = options.timeoutMs
    }
    const result = await dispatchCapability('http.fetch', params, {
      principal: ctx.principal,
    })
    if (!result.ok) {
      throw new Error(`Nd:http (${result.code}): ${result.error}`)
    }
    const response = result.result as {
      status: number
      headers: Record<string, string>
      body: string
    }
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
    ctx.disposers.push(unsubscribe)

    // AiScript 側に返す unsubscribe 関数
    return values.FN_NATIVE(() => {
      unsubscribe()
      const idx = ctx.disposers.indexOf(unsubscribe)
      if (idx >= 0) ctx.disposers.splice(idx, 1)
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
      // 旧実装は全プラグイン共通の `nd-plugin:` 名前空間だったため、別々の
      // プラグインが同じ id を使うと無言で後勝ち上書きされていた
      const commandId = makeRegistrationId(ctx.provider, idVal.value)
      if (commandStore.commands.has(commandId)) {
        throw new Error(
          `Nd:register_command: "${commandId}" already registered`,
        )
      }
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
      ctx.disposers.push(() => commandStore.unregister(commandId))
    },
  )

  return consts
}

/**
 * Cleanup NoteDeck API resources (unregister commands, unsubscribe events).
 * プラグイン abort / カラム破棄 / interpreter 再起動時に呼ばれる。
 */
export function cleanupNoteDeckEnv(ctx: NoteDeckEnvContext): void {
  // 配列を先に空にしてから回す。解除中に例外が出ても未解除分が残らないよう、
  // また二重 cleanup で同じ disposer が二度走らないようにするため。
  const disposers = ctx.disposers.splice(0, ctx.disposers.length)
  for (const dispose of disposers) {
    try {
      dispose()
    } catch (e) {
      // 1 つの失敗で残りの解除を止めない (解除漏れの方が被害が大きい)
      console.warn('[cleanupNoteDeckEnv] dispose failed:', e)
    }
  }
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
