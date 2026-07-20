import { type Ast, type Interpreter, utils, values } from '@syuilo/aiscript'
import type { Value, VFn } from '@syuilo/aiscript/interpreter/value.js'
import type { JsonValue } from '@/bindings'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  type AiScriptRunLogger,
  useAiScriptLogsStore,
} from '@/stores/aiscriptLogs'
import {
  isPluginEffectiveFor,
  type PluginConfigDef,
  type PluginMeta,
  usePluginsStore,
} from '@/stores/plugins'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { openSafeUrl } from '@/utils/url'
import { createAiScriptEnv } from './api'
import {
  createAiScriptInterpreter,
  createInterpreterOptions,
  execAiScript,
  isLegacyScript,
  parseAiScript,
} from './common'
import {
  cleanupNoteDeckEnv,
  createNoteDeckEnv,
  type NoteDeckEnvContext,
} from './notedeck-api'
import { sanitizeCode } from './sanitize'

// ---------------------------------------------------------------------------
// Metadata parsing
// ---------------------------------------------------------------------------

export interface ParsedPluginMeta {
  name: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  config?: Record<string, PluginConfigDef>
}

/**
 * Extract plugin metadata from the `### { ... }` header block.
 * Returns null if the header is missing or malformed.
 */
export function parsePluginMeta(code: string): ParsedPluginMeta | null {
  const body = extractMetaBlock(code)
  if (!body) return null

  try {
    const obj = parseMetaBlock(body)
    if (
      !obj ||
      typeof obj.name !== 'string' ||
      typeof obj.version !== 'string'
    ) {
      return null
    }

    const meta: ParsedPluginMeta = {
      name: obj.name as string,
      version: String(obj.version),
    }
    if (typeof obj.author === 'string') meta.author = obj.author
    if (typeof obj.description === 'string') meta.description = obj.description
    if (Array.isArray(obj.permissions)) {
      meta.permissions = obj.permissions.filter(
        (p: unknown): p is string => typeof p === 'string',
      )
    }
    if (obj.config && typeof obj.config === 'object') {
      meta.config = obj.config as Record<string, PluginConfigDef>
    }
    return meta
  } catch {
    return null
  }
}

/**
 * Extract the body between `### { ... }` handling nested braces.
 * Allows comments/version declaration before `###`.
 */
function extractMetaBlock(code: string): string | null {
  const startMatch = code.match(/^[^\n]*###\s*\{/m)
  if (!startMatch) return null

  const openIndex = (startMatch.index ?? 0) + startMatch[0].length
  let depth = 1
  let i = openIndex
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') depth--
    i++
  }
  if (depth !== 0) return null
  return code.slice(openIndex, i - 1)
}

/**
 * Parse the meta block body into a plain object.
 * The format is: `key: value` per line, with nested objects for config.
 * We use a simple JSON5-like approach.
 */
function parseMetaBlock(body: string): Record<string, unknown> | null {
  try {
    // Strip line comments (// ...) before parsing
    const stripped = body.replace(/\/\/[^\n]*/g, '')
    // Wrap in braces and try JSON parse with relaxed quoting
    const jsonish = `{${stripped}}`
      // Add quotes around unquoted keys
      .replace(/^\s*([\w]+)\s*:/gm, '"$1":')
      // Replace single quotes with double quotes
      .replace(/'/g, '"')
      // Add missing commas between values on separate lines
      .replace(/("|\d+|true|false|null|\]|\})\s*$/gm, '$1,')
      // Remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1')
      // Remove trailing comma at end of string
      .replace(/,\s*$/, '')
    return JSON.parse(jsonish) as Record<string, unknown>
  } catch {
    // Fallback: line-by-line parse for simple key: "value" pairs
    const result: Record<string, unknown> = {}
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*([\w]+)\s*:\s*"([^"]*)"/)
      if (m) result[m[1] ?? ''] = m[2]
    }
    return Object.keys(result).length > 0 ? result : null
  }
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

type HandlerType =
  | 'note_action'
  | 'note_view_interruptor'
  | 'note_post_interruptor'
  | 'post_form_action'
  | 'user_action'
  | 'page_view_interruptor'

export interface PluginHandler {
  pluginInstallId: string
  type: HandlerType
  title?: string
  // biome-ignore lint: handler signatures vary per type
  handler: (...args: any[]) => any
}

const pluginHandlers: PluginHandler[] = []
const pluginContexts = new Map<string, Interpreter>()
const pluginAccountContext = new Map<string, { accountId: string | null }>()
const pluginNdContexts = new Map<string, NoteDeckEnvContext>()

/**
 * type に該当する handler をスコープ評価 (#771) して返す。
 * 有効 = 提供元 plugin が全体スコープ (global) OR 対象アカウントの
 * アカウント別スコープ (installedFor に安定キー一致)。
 * accountId (内部 UUID) は accounts store 経由で安定キーに解決する。
 * accountId が null/undefined (アカウント文脈なし) の場合は全体スコープのみ。
 */
export function getPluginHandlers<T extends HandlerType>(
  type: T,
  accountId?: string | null,
): PluginHandler[] {
  const matched = pluginHandlers.filter((h) => h.type === type)
  if (matched.length === 0) return matched
  const account = accountId
    ? useAccountsStore().accounts.find((a) => a.id === accountId)
    : undefined
  const scopeKey = account ? accountScopeKey(account) : null
  const plugins = usePluginsStore().plugins
  return matched.filter((h) => {
    const plugin = plugins.find((p) => p.installId === h.pluginInstallId)
    return plugin ? isPluginEffectiveFor(plugin, scopeKey) : false
  })
}

function addPluginHandler(handler: PluginHandler) {
  pluginHandlers.push(handler)
}

function removePluginHandlers(installId: string) {
  for (let i = pluginHandlers.length - 1; i >= 0; i--) {
    if (pluginHandlers[i]?.pluginInstallId === installId) {
      pluginHandlers.splice(i, 1)
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin environment (Plugin:* APIs)
// ---------------------------------------------------------------------------

function createPluginSpecificEnv(
  plugin: PluginMeta,
  ctx: { accountId: string | null },
): Record<string, Value> {
  const id = plugin.installId
  const consts: Record<string, Value> = {}

  // interruptor は sync 適用 (execFnSync) が前提だが、バージョンヘッダー無しの
  // コードが落ちる legacy interpreter (0.19) には execFnSync が無い。
  // 登録だけ成功して変換が一切効かない silent fail になるため、登録自体を
  // 拒否して run ログで通知する。
  const legacy = isLegacyScript(sanitizeCode(plugin.src))
  const rejectLegacyInterruptor = (name: string): boolean => {
    if (!legacy) return false
    pluginRunLoggers
      .get(id)
      ?.system(
        `${name} requires an AiScript version header (/// @ 1.x); ignored on legacy scripts`,
      )
    return true
  }

  // --- Plugin:register_note_action ---
  consts['Plugin:register_note_action'] = values.FN_NATIVE(
    ([titleVal, handlerVal]) => {
      utils.assertString(titleVal)
      utils.assertFunction(handlerVal)
      addPluginHandler({
        pluginInstallId: id,
        type: 'note_action',
        title: titleVal.value,
        handler: (note: unknown) => {
          const interp = pluginContexts.get(id)
          if (!interp) return
          interp.execFn(handlerVal as VFn, [utils.jsToVal(note)])
        },
      })
    },
  )

  // --- Plugin:register_user_action ---
  consts['Plugin:register_user_action'] = values.FN_NATIVE(
    ([titleVal, handlerVal]) => {
      utils.assertString(titleVal)
      utils.assertFunction(handlerVal)
      addPluginHandler({
        pluginInstallId: id,
        type: 'user_action',
        title: titleVal.value,
        handler: (user: unknown) => {
          const interp = pluginContexts.get(id)
          if (!interp) return
          interp.execFn(handlerVal as VFn, [utils.jsToVal(user)])
        },
      })
    },
  )

  // --- Plugin:register_post_form_action ---
  consts['Plugin:register_post_form_action'] = values.FN_NATIVE(
    ([titleVal, handlerVal]) => {
      utils.assertString(titleVal)
      utils.assertFunction(handlerVal)
      addPluginHandler({
        pluginInstallId: id,
        type: 'post_form_action',
        title: titleVal.value,
        handler: (
          form: unknown,
          update: (key: unknown, value: unknown) => void,
        ): void => {
          const interp = pluginContexts.get(id)
          if (!interp) return
          interp.execFn(handlerVal as VFn, [
            utils.jsToVal(form),
            values.FN_NATIVE(([keyVal, valueVal]) => {
              if (!keyVal || !valueVal) return
              update(utils.valToJs(keyVal), utils.valToJs(valueVal))
            }),
          ])
        },
      })
    },
  )

  // --- Plugin:register_note_view_interruptor ---
  consts['Plugin:register_note_view_interruptor'] = values.FN_NATIVE(
    ([handlerVal]) => {
      utils.assertFunction(handlerVal)
      if (rejectLegacyInterruptor('Plugin:register_note_view_interruptor'))
        return
      addPluginHandler({
        pluginInstallId: id,
        type: 'note_view_interruptor',
        handler: (note: unknown) => {
          const interp = pluginContexts.get(id)
          if (!interp) return note
          return utils.valToJs(
            interp.execFnSync(handlerVal as VFn, [utils.jsToVal(note)]),
          )
        },
      })
    },
  )

  // --- Plugin:register_note_post_interruptor ---
  consts['Plugin:register_note_post_interruptor'] = values.FN_NATIVE(
    ([handlerVal]) => {
      utils.assertFunction(handlerVal)
      if (rejectLegacyInterruptor('Plugin:register_note_post_interruptor'))
        return
      addPluginHandler({
        pluginInstallId: id,
        type: 'note_post_interruptor',
        handler: (note: unknown) => {
          const interp = pluginContexts.get(id)
          if (!interp) return note
          return utils.valToJs(
            interp.execFnSync(handlerVal as VFn, [utils.jsToVal(note)]),
          )
        },
      })
    },
  )

  // --- Plugin:register_page_view_interruptor ---
  consts['Plugin:register_page_view_interruptor'] = values.FN_NATIVE(
    ([handlerVal]) => {
      utils.assertFunction(handlerVal)
      if (rejectLegacyInterruptor('Plugin:register_page_view_interruptor'))
        return
      addPluginHandler({
        pluginInstallId: id,
        type: 'page_view_interruptor',
        handler: (page: unknown) => {
          const interp = pluginContexts.get(id)
          if (!interp) return page
          return utils.valToJs(
            interp.execFnSync(handlerVal as VFn, [utils.jsToVal(page)]),
          )
        },
      })
    },
  )

  // Underscore aliases for backwards compat (Misskey supports both : and _)
  const noteAction = consts['Plugin:register_note_action']
  const userAction = consts['Plugin:register_user_action']
  const postFormAction = consts['Plugin:register_post_form_action']
  const noteViewInterruptor = consts['Plugin:register_note_view_interruptor']
  const notePostInterruptor = consts['Plugin:register_note_post_interruptor']
  const pageViewInterruptor = consts['Plugin:register_page_view_interruptor']
  if (noteAction) consts['Plugin:register:note_action'] = noteAction
  if (userAction) consts['Plugin:register:user_action'] = userAction
  if (postFormAction)
    consts['Plugin:register:post_form_action'] = postFormAction
  if (noteViewInterruptor)
    consts['Plugin:register:note_view_interruptor'] = noteViewInterruptor
  if (notePostInterruptor)
    consts['Plugin:register:note_post_interruptor'] = notePostInterruptor
  if (pageViewInterruptor)
    consts['Plugin:register:page_view_interruptor'] = pageViewInterruptor

  // --- Plugin:open_url ---
  consts['Plugin:open_url'] = values.FN_NATIVE(
    async ([urlVal]): Promise<Value> => {
      if (urlVal?.type !== 'str') return values.NULL
      await openSafeUrl(urlVal.value)
      return values.NULL
    },
  )

  // --- Plugin:config ---
  const configMap = new Map<string, Value>()
  if (plugin.config) {
    for (const [key, def] of Object.entries(plugin.config)) {
      const val =
        key in plugin.configData ? plugin.configData[key] : def.default
      configMap.set(key, utils.jsToVal(val))
    }
  }
  consts['Plugin:config'] = values.OBJ(configMap)

  // --- Mk:api with dynamic account context ---
  consts['Mk:api'] = values.FN_NATIVE(async ([endpointVal, paramsVal]) => {
    const accountId = ctx.accountId
    if (!accountId) {
      throw new Error('Mk:api: no account context available')
    }
    const endpoint = endpointVal?.type === 'str' ? endpointVal.value : ''
    // プラグインの生 Misskey API は endpoint 対応表 gate に従属 (#712 / #711)
    await assertMisskeyApiAllowed(
      { kind: 'plugin', pluginId: plugin.installId, name: plugin.name },
      endpoint,
    )
    const params =
      paramsVal?.type === 'obj'
        ? (utils.valToJs(paramsVal) as Record<string, unknown>)
        : {}
    const result = unwrap(
      await commands.apiRequest(accountId, endpoint, params as JsonValue),
    )
    return utils.jsToVal(result)
  })

  return consts
}

// ---------------------------------------------------------------------------
// Interruptor helpers
// ---------------------------------------------------------------------------

/**
 * Apply all note_view_interruptors to a note object (sync).
 * accountId が渡されればスコープ評価 (#771) で有効/無効が判定される。
 */
export function applyNoteViewInterruptors<T>(
  note: T,
  accountId?: string | null,
): T {
  const handlers = getPluginHandlers('note_view_interruptor', accountId)
  if (handlers.length === 0) return note
  let result = note
  for (const h of handlers) {
    try {
      const modified = h.handler(result) as T | undefined
      if (modified != null) result = modified
    } catch (e) {
      console.warn('[plugin:note_view_interruptor]', e)
    }
  }
  return result
}

/**
 * Apply all page_view_interruptors to a page object (sync).
 */
export function applyPageViewInterruptors<T>(
  page: T,
  accountId?: string | null,
): T {
  const handlers = getPluginHandlers('page_view_interruptor', accountId)
  if (handlers.length === 0) return page
  let result = page
  for (const h of handlers) {
    try {
      const modified = h.handler(result) as T | undefined
      if (modified != null) result = modified
    } catch (e) {
      console.warn('[plugin:page_view_interruptor]', e)
    }
  }
  return result
}

/**
 * Apply all note_post_interruptors to a post form object (sync).
 */
export function applyNotePostInterruptors<T>(
  form: T,
  accountId?: string | null,
): T {
  const handlers = getPluginHandlers('note_post_interruptor', accountId)
  if (handlers.length === 0) return form
  let result = form
  for (const h of handlers) {
    try {
      const modified = h.handler(result) as T | undefined
      if (modified != null) result = modified
    } catch (e) {
      console.warn('[plugin:note_post_interruptor]', e)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Launch / Abort
// ---------------------------------------------------------------------------

// 実行ログは useAiScriptLogsStore に集約する (#710)。実行中の書き込み口を
// installId ごとに保持し、abort 時の system イベント記録に使う。
const pluginRunLoggers = new Map<string, AiScriptRunLogger>()

export async function launchPlugin(plugin: PluginMeta): Promise<void> {
  if (!plugin.src || !plugin.active) return

  // Abort existing instance if re-launching
  abortPlugin(plugin.installId)

  const runLog = useAiScriptLogsStore().beginRun(
    'plugin',
    plugin.installId,
    plugin.name,
  )
  pluginRunLoggers.set(plugin.installId, runLog)

  const ctx = { accountId: null as string | null }
  pluginAccountContext.set(plugin.installId, ctx)

  // Build environment: base Mk:* (overridden by plugin-specific Mk:api) + Plugin:* + Nd:*
  const baseEnv = createAiScriptEnv(
    {
      principal: {
        kind: 'plugin',
        pluginId: plugin.installId,
        name: plugin.name,
      },
      storagePrefix: `plugin:${plugin.installId}`,
    },
    { LOCALE: navigator.language },
  )
  const pluginEnv = createPluginSpecificEnv(plugin, ctx)

  // Nd:* APIs (lazy import to avoid circular deps)
  const { useCommandStore } = await import('@/commands/registry')
  const ndCtx: NoteDeckEnvContext = {
    commandStore: useCommandStore(),
    // MisStore 等から入れる第三者コード — plugin principal で enforce (#712)
    principal: {
      kind: 'plugin',
      pluginId: plugin.installId,
      name: plugin.name,
    },
    registeredCommandIds: [],
    subscriptions: [],
  }
  const ndEnv = createNoteDeckEnv(ndCtx)
  pluginNdContexts.set(plugin.installId, ndCtx)

  // Plugin-specific Mk:api overrides the base one
  const env = { ...baseEnv, ...pluginEnv, ...ndEnv }

  const ioOpts = createInterpreterOptions({
    onOutput: (text) => runLog.print(text),
    onError: (err) => runLog.error(err.message),
  })

  const code = sanitizeCode(plugin.src)

  let ast: Ast.Node[]
  let legacy: boolean
  try {
    const result = parseAiScript(code)
    ast = result.ast
    legacy = result.legacy
  } catch (e) {
    runLog.system(`parse error: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  const interpreter = createAiScriptInterpreter(env, ioOpts, legacy)
  ndCtx.interpreter = interpreter
  try {
    await execAiScript(interpreter, ast, legacy)
    runLog.system('run completed')
  } catch (e) {
    runLog.system(`run aborted: ${e instanceof Error ? e.message : String(e)}`)
  }
  pluginContexts.set(plugin.installId, interpreter)
}

export function abortPlugin(installId: string): void {
  const interp = pluginContexts.get(installId)
  if (interp) {
    interp.abort()
    pluginContexts.delete(installId)
    pluginRunLoggers.get(installId)?.system('aborted')
  }
  const ndCtx = pluginNdContexts.get(installId)
  if (ndCtx) {
    cleanupNoteDeckEnv(ndCtx)
    pluginNdContexts.delete(installId)
  }
  pluginAccountContext.delete(installId)
  pluginRunLoggers.delete(installId)
  removePluginHandlers(installId)
}

/**
 * Set the account context for a plugin before calling its handler.
 * This makes Mk:api use the correct account for API calls.
 */
export function setPluginAccountContext(
  installId: string,
  accountId: string,
): void {
  const ctx = pluginAccountContext.get(installId)
  if (ctx) ctx.accountId = accountId
}

/**
 * Launch all active plugins. Called once on app startup.
 */
export async function launchAllPlugins(plugins: PluginMeta[]): Promise<void> {
  const active = plugins.filter((p) => p.active && p.src)
  await Promise.allSettled(active.map((p) => launchPlugin(p)))
}

/**
 * Abort all running plugins. Called on app teardown.
 */
export function abortAllPlugins(): void {
  for (const installId of pluginContexts.keys()) {
    abortPlugin(installId)
  }
}
