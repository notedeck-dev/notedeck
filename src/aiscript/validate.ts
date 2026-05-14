/**
 * AiScript 構文検証の共有モジュール。
 *
 * - LSP worker / CodeMirror linter / `aiscript.validate` capability の 3 経路で
 *   同じ Parser 呼び出しを使うための単一窓口
 * - 同期 Parser ベース。意味解析 (未定義変数 / 名前空間タイポ / 引数 arity) は
 *   将来公式 LSP を web worker 化したときに置き換える (Phase 2)
 */

import { Parser } from '@syuilo/aiscript'
import { sanitizeCode } from './sanitize'

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface AiScriptDiagnostic {
  severity: DiagnosticSeverity
  message: string
  /** 1-based 行番号 (LSP / IDE 慣例) */
  line: number
  /** 1-based 列番号 */
  column: number
  endLine: number
  endColumn: number
}

export interface ValidateResult {
  ok: boolean
  diagnostics: AiScriptDiagnostic[]
}

export interface ValidateOptions {
  /** 将来的に entryPoint 別チェック (plugin = メタヘッダ必須 等) を分岐させるための余地 */
  entryPoint?: 'plugin' | 'widget'
}

export function validateAiScript(
  src: string,
  _options: ValidateOptions = {},
): ValidateResult {
  const code = sanitizeCode(src)
  if (!code.trim()) {
    return { ok: true, diagnostics: [] }
  }

  try {
    const parser = new Parser()
    parser.parse(code)
    return { ok: true, diagnostics: [] }
  } catch (e) {
    return { ok: false, diagnostics: [parserErrorToDiagnostic(e, code)] }
  }
}

function parserErrorToDiagnostic(e: unknown, code: string): AiScriptDiagnostic {
  const message = e instanceof Error ? e.message : String(e)
  const lineMatch = message.match(/at line (\d+)/i)
  const lines = code.split('\n')
  let line = 1
  if (lineMatch) {
    const parsed = Number.parseInt(lineMatch[1] ?? '1', 10)
    line = Math.min(Math.max(1, parsed), lines.length)
  }
  const endColumn = Math.max(1, (lines[line - 1] ?? '').length + 1)
  return {
    severity: 'error',
    message,
    line,
    column: 1,
    endLine: line,
    endColumn,
  }
}
