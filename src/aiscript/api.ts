import { utils, values } from '@syuilo/aiscript'
import type { Value } from '@syuilo/aiscript/interpreter/value.js'
import { openUrl } from '@tauri-apps/plugin-opener'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import type { Principal } from '@/permissions/principal'
import { useConfirm } from '@/stores/confirm'
import {
  getStorageString,
  removeStorage,
  setStorageJson,
} from '@/utils/storage'

// Misskey 本家の nyaize 実装 (misskey-js/src/nyaize.ts)
const enRegex1 = /(?<=n)a/gi
const enRegex2 = /(?<=morn)ing/gi
const enRegex3 = /(?<=every)one/gi
const koRegex1 = /[나-낳]/g
const koRegex2 = /(다$)|(다(?=\.))|(다(?= ))|(다(?=!))|(다(?=\?))/gm
const koRegex3 = /(야(?=\?))|(야$)|(야(?= ))/gm

function nyaize(text: string): string {
  return text
    .replaceAll('な', 'にゃ')
    .replaceAll('ナ', 'ニャ')
    .replaceAll('ﾅ', 'ﾆｬ')
    .replace(enRegex1, (x) => (x === 'A' ? 'YA' : 'ya'))
    .replace(enRegex2, (x) => (x === 'ING' ? 'YAN' : 'yan'))
    .replace(enRegex3, (x) => (x === 'ONE' ? 'NYAN' : 'nyan'))
    .replace(koRegex1, (match) =>
      !Number.isNaN(match.charCodeAt(0))
        ? String.fromCharCode(
            match.charCodeAt(0) + '냐'.charCodeAt(0) - '나'.charCodeAt(0),
          )
        : match,
    )
    .replace(koRegex2, '다냥')
    .replace(koRegex3, '냥')
}

export interface AiScriptEnvOptions {
  /**
   * この env で動くコードの principal (#712 §5.5)。plugin principal の
   * Mk:api は endpoint 対応表 gate で判定される。user (playground) は免除。
   */
  principal: Principal
  /** Mk:api の実装。未設定なら Mk:api は使用不可エラー */
  api?: (endpoint: string, params: Record<string, unknown>) => Promise<unknown>
  /** localStorage のキー prefix（Mk:save/Mk:load 用） */
  storagePrefix?: string
  /** Mk:dialog のUI実装 */
  onDialog?: (
    title: string,
    text: string,
    type: 'info' | 'success' | 'warning' | 'error',
  ) => Promise<void>
  /** Mk:confirm のUI実装 */
  onConfirm?: (title: string, text: string) => Promise<boolean>
  /** Mk:toast のUI実装 */
  onToast?: (
    text: string,
    type: 'info' | 'success' | 'warning' | 'error',
  ) => void
}

export interface AiScriptGlobalConstants {
  THIS_ID?: string
  THIS_URL?: string
  USER_ID?: string
  USER_NAME?: string
  USER_USERNAME?: string
  CUSTOM_EMOJIS?: unknown[]
  LOCALE?: string
  SERVER_URL?: string
}

/**
 * Mk:* API とグローバル定数を Record<string, Value> で返す。
 * Interpreter の consts に spread して使う。
 */
export function createAiScriptEnv(
  options: AiScriptEnvOptions,
  globals?: AiScriptGlobalConstants,
): Record<string, Value> {
  const consts: Record<string, Value> = {}
  const storageKey = (key: string) =>
    `nd-aiscript-${options.storagePrefix ?? 'default'}:${key}`

  // --- Mk:dialog ---
  consts['Mk:dialog'] = values.FN_NATIVE(
    async ([titleVal, textVal, typeVal]) => {
      const title = titleVal?.type === 'str' ? titleVal.value : ''
      const text = textVal?.type === 'str' ? textVal.value : ''
      const type = (typeVal?.type === 'str' ? typeVal.value : 'info') as
        | 'info'
        | 'success'
        | 'warning'
        | 'error'
      if (options.onDialog) {
        await options.onDialog(title, text, type)
      } else {
        const { confirm } = useConfirm()
        await confirm({
          title,
          message: text,
          okLabel: 'OK',
          hideCancel: true,
          type,
        })
      }
      return values.NULL
    },
  )

  // --- Mk:confirm ---
  consts['Mk:confirm'] = values.FN_NATIVE(async ([titleVal, textVal]) => {
    const title = titleVal?.type === 'str' ? titleVal.value : ''
    const text = textVal?.type === 'str' ? textVal.value : ''
    if (options.onConfirm) {
      const result = await options.onConfirm(title, text)
      return values.BOOL(result)
    }
    const { confirm } = useConfirm()
    const result = await confirm({ title, message: text, type: 'question' })
    return values.BOOL(result)
  })

  // --- Mk:api ---
  consts['Mk:api'] = values.FN_NATIVE(async ([endpointVal, paramsVal]) => {
    if (!options.api) {
      throw new Error('Mk:api is not available')
    }
    const endpoint = endpointVal?.type === 'str' ? endpointVal.value : ''
    // plugin principal は endpoint 対応表 gate で判定 (#712 §5.5 / #711)。
    // 拒否なら throw (プラグイン作者向けの理由付きメッセージ)
    await assertMisskeyApiAllowed(options.principal, endpoint)
    const params =
      paramsVal?.type === 'obj'
        ? (utils.valToJs(paramsVal) as Record<string, unknown>)
        : {}
    const result = await options.api(endpoint, params)
    return utils.jsToVal(result)
  })

  // --- Mk:save ---
  consts['Mk:save'] = values.FN_NATIVE(([keyVal, valueVal]) => {
    if (keyVal?.type !== 'str' || !valueVal) return
    try {
      setStorageJson(storageKey(keyVal.value), utils.valToJs(valueVal))
    } catch {
      // ignore storage errors
    }
  })

  // --- Mk:load ---
  consts['Mk:load'] = values.FN_NATIVE(([keyVal]) => {
    if (keyVal?.type !== 'str') return values.NULL
    try {
      const raw = getStorageString(storageKey(keyVal.value))
      if (raw === null) return values.NULL
      return utils.jsToVal(JSON.parse(raw))
    } catch {
      return values.NULL
    }
  })

  // --- Mk:remove ---
  consts['Mk:remove'] = values.FN_NATIVE(([keyVal]) => {
    if (keyVal?.type !== 'str') return
    try {
      removeStorage(storageKey(keyVal.value))
    } catch {
      // ignore storage errors
    }
  })

  // --- Mk:toast ---
  consts['Mk:toast'] = values.FN_NATIVE(([textVal, typeVal]) => {
    const text = textVal?.type === 'str' ? textVal.value : ''
    const type = typeVal?.type === 'str' ? typeVal.value : 'info'
    if (options.onToast) {
      options.onToast(text, type as 'info' | 'success' | 'warning' | 'error')
    }
  })

  // --- Mk:url ---
  consts['Mk:url'] = values.FN_NATIVE(async ([urlVal]) => {
    const url = urlVal?.type === 'str' ? urlVal.value : ''
    if (url) await openUrl(url)
    return values.NULL
  })

  // --- Mk:nyaize ---
  consts['Mk:nyaize'] = values.FN_NATIVE(([textVal]) => {
    const text = textVal?.type === 'str' ? textVal.value : ''
    return values.STR(nyaize(text))
  })

  // --- グローバル定数 ---
  if (globals) {
    if (globals.THIS_ID !== undefined)
      consts.THIS_ID = values.STR(globals.THIS_ID)
    if (globals.THIS_URL !== undefined)
      consts.THIS_URL = values.STR(globals.THIS_URL)
    if (globals.USER_ID !== undefined)
      consts.USER_ID = values.STR(globals.USER_ID)
    if (globals.USER_NAME !== undefined)
      consts.USER_NAME = values.STR(globals.USER_NAME)
    if (globals.USER_USERNAME !== undefined)
      consts.USER_USERNAME = values.STR(globals.USER_USERNAME)
    if (globals.LOCALE !== undefined) consts.LOCALE = values.STR(globals.LOCALE)
    if (globals.SERVER_URL !== undefined)
      consts.SERVER_URL = values.STR(globals.SERVER_URL)
    if (globals.CUSTOM_EMOJIS !== undefined)
      consts.CUSTOM_EMOJIS = utils.jsToVal(globals.CUSTOM_EMOJIS)
  }

  return consts
}
