/**
 * AI チャットカラムの `/` コマンド入力を、AI を介さず直接 capability として
 * 実行するためのパーサ + runner。
 *
 * - `/<id> [k=v]...` 形式を tokenize し dispatchCapability に流す
 * - `/help` または `/` 単体で aiTool 公開済み capability の一覧を返す
 * - 結果は AI tool_use と同じ UI (toolUseId / toolResultFor) で表示できるよう
 *   `slashUseId` を発行する (`slash-<ts>-<rand>`)
 *
 * AI を介さないので、AI provider 未接続でも動作する。permissions は AI の
 * tool 経由と同じ `dispatchCapability` を通すので、`safe` プリセットで
 * write 系を撃てばちゃんと拒否される。
 */

import { dispatchCapability } from '@/capabilities/dispatcher'
import { listCapabilities } from '@/capabilities/registry'
import type { AiConfig } from './useAiConfig'

export interface ParsedSlashCommand {
  id: string
  params: Record<string, unknown>
}

export type SlashRunResult =
  | {
      ok: true
      kind: 'help'
      displayName: '/help'
      result: string
      slashUseId: string
    }
  | {
      ok: true
      kind: 'capability'
      displayName: string
      params: Record<string, unknown>
      result: unknown
      slashUseId: string
    }
  | {
      ok: false
      kind:
        | 'parse_error'
        | 'unknown_capability'
        | 'permission_denied'
        | 'preflight_failed'
        | 'execute_failed'
        | 'user_cancelled'
      displayName: string
      params?: Record<string, unknown>
      error: string
      slashUseId: string
    }

/**
 * `/` で始まる入力か判定する。前後の空白は trim 済みを想定。
 */
export function isSlashCommand(text: string): boolean {
  return text.startsWith('/')
}

/**
 * `/cmd k=v k2="quoted"` 形式の入力を tokenize する。
 *
 * 戻り値:
 * - `{ id, params }`: 成功
 * - `null`: 構文不正 (id が無い、key=value の = が無い等)
 *
 * 値の自動変換:
 * - `true` / `false` → boolean
 * - 整数 / 小数 → number (Number.isFinite)
 * - それ以外 → string
 *
 * クォート: `"..."` 内は空白を含めて 1 token。エスケープは未対応 (Phase 1)。
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  if (!text.startsWith('/')) return null
  const body = text.slice(1).trim()
  if (body.length === 0) return { id: '', params: {} }

  const tokens = tokenize(body)
  if (tokens === null || tokens.length === 0) return null
  const [id, ...rest] = tokens
  if (!id || id.length === 0) return null

  const params: Record<string, unknown> = {}
  for (const tok of rest) {
    const eq = tok.indexOf('=')
    if (eq <= 0) return null
    const key = tok.slice(0, eq)
    const rawVal = tok.slice(eq + 1)
    params[key] = coerceValue(rawVal)
  }
  return { id, params }
}

function tokenize(s: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuote) {
      if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuote = true
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (cur.length > 0) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (inQuote) return null
  if (cur.length > 0) out.push(cur)
  return out
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.length > 0) {
    const n = Number(raw)
    if (Number.isFinite(n) && raw.trim() !== '') {
      // 数値風文字列のみ Number 化 (空文字は Number('') === 0 になるので除外)
      // 先頭 0 の ID 等を壊さないよう、`/^-?\d+(\.\d+)?$/` に合致するかも見る
      if (/^-?\d+(?:\.\d+)?$/.test(raw)) return n
    }
  }
  return raw
}

/**
 * `/help` または `/` 単体で出す capability 一覧の Markdown 文字列を組む。
 * aiTool: true な capability のみ列挙する (= AI に見せている範囲)。
 */
export function buildSlashHelpText(): string {
  const caps = listCapabilities().filter((c) => c.aiTool && c.signature)
  if (caps.length === 0) return '利用可能なコマンドはありません。'
  const lines: string[] = ['利用可能な /コマンド:', '']
  for (const cap of caps) {
    const desc = cap.signature?.description ?? ''
    lines.push(`- \`/${cap.id}\` — ${desc}`)
    const params = cap.signature?.params ?? {}
    const keys = Object.keys(params)
    if (keys.length > 0) {
      const sig = keys
        .map((k) => {
          const p = params[k]
          const opt = p?.optional ? '?' : ''
          return `${k}${opt}=<${p?.type ?? 'any'}>`
        })
        .join(' ')
      lines.push(`  - 引数: ${sig}`)
    }
  }
  return lines.join('\n')
}

function newSlashUseId(): string {
  return `slash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * パース + dispatch をまとめて実行する。AI チャット側はこの戻り値だけ見て
 * tool_use 風メッセージを 1 組生成する。
 */
export async function runSlashCommand(
  text: string,
  aiConfig: AiConfig,
): Promise<SlashRunResult> {
  const slashUseId = newSlashUseId()
  const parsed = parseSlashCommand(text)
  if (!parsed) {
    return {
      ok: false,
      kind: 'parse_error',
      displayName: text,
      error: 'コマンドの構文が不正です。例: /notes.timeline type=local limit=5',
      slashUseId,
    }
  }
  // `/` 単体 / `/help` → ヘルプ
  if (parsed.id === '' || parsed.id === 'help') {
    return {
      ok: true,
      kind: 'help',
      displayName: '/help',
      result: buildSlashHelpText(),
      slashUseId,
    }
  }
  const dispatch = await dispatchCapability(parsed.id, parsed.params, aiConfig)
  if (!dispatch.ok) {
    return {
      ok: false,
      kind: dispatch.code,
      displayName: `/${parsed.id}`,
      params: parsed.params,
      error: dispatch.error,
      slashUseId,
    }
  }
  return {
    ok: true,
    kind: 'capability',
    displayName: `/${parsed.id}`,
    params: parsed.params,
    result: dispatch.result,
    slashUseId,
  }
}
