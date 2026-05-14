import { type Diagnostic, linter } from '@codemirror/lint'
import { validateAiScript } from '@/aiscript/validate'

export const aiscriptLinter = linter(
  (view) => {
    const result = validateAiScript(view.state.doc.toString())
    if (result.ok) return []

    return result.diagnostics.map((d): Diagnostic => {
      const lineNum = Math.min(Math.max(1, d.line), view.state.doc.lines)
      const line = view.state.doc.line(lineNum)
      return {
        from: line.from,
        to: line.to,
        severity: d.severity === 'error' ? 'error' : 'warning',
        message: d.message,
      }
    })
  },
  { delay: 500 },
)
