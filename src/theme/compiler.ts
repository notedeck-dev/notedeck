import * as color from './colorUtils'
import type { CompiledProps, MisskeyTheme } from './types'

const COLOR_FUNCS: Record<string, (c: string, a: number) => string> = {
  darken: color.darken,
  lighten: color.lighten,
  alpha: color.alpha,
  hue: color.hue,
  saturate: color.saturate,
}

export function compileMisskeyTheme(
  theme: MisskeyTheme,
  baseTheme: MisskeyTheme,
): CompiledProps {
  // Merge: base props as defaults, theme props override
  const props: Record<string, string> = { ...baseTheme.props, ...theme.props }
  const compiled: CompiledProps = {}

  function resolve(key: string, visited: Set<string>): string {
    if (compiled[key] !== undefined) return compiled[key]

    const raw = props[key]
    if (raw === undefined) return ''

    if (visited.has(key)) return '' // circular reference guard
    visited.add(key)

    const result = evaluate(raw, visited)
    compiled[key] = result
    return result
  }

  function evaluate(expr: string, visited: Set<string>): string {
    expr = expr.trim()

    // Raw CSS: starts with "
    if (expr.startsWith('"')) {
      return expr.slice(1).replace(/var\(--MI_THEME-(\w+)\)/g, 'var(--nd-$1)')
    }

    // Property reference: @propName
    if (expr.startsWith('@')) {
      const refKey = expr.slice(1)
      return resolve(refKey, new Set(visited))
    }

    // Color function: :func<arg<value
    if (expr.startsWith(':')) {
      const funcMatch = expr.match(/^:(\w+)<([^<]+)<(.+)$/)
      if (funcMatch) {
        const [, funcName, arg, rest] = funcMatch
        const fn = funcName ? COLOR_FUNCS[funcName] : undefined
        if (fn && rest) {
          const resolvedColor = evaluate(rest, visited)
          return fn(resolvedColor, Number(arg))
        }
      }
      return expr // unknown function, return as-is
    }

    // 定数参照: $name。本家と同じく `$` で始まる prop を値として引く
    // (以前は黙って空文字になり、参照した色がすべて消えていた)
    if (expr.startsWith('$')) {
      return resolve(expr, new Set(visited))
    }

    // Literal color value
    return color.normalizeColor(expr)
  }

  // Compile all props
  for (const key of Object.keys(props)) {
    if (compiled[key] === undefined) {
      resolve(key, new Set())
    }
  }
  // $ 定数は参照のためだけの値で、CSS 変数としては出さない (本家と同じ)
  for (const key of Object.keys(compiled)) {
    if (key.startsWith('$')) delete compiled[key]
  }

  // NoteDeck 独自の派生変数: テーマが明示しない限り accent から算出する
  // (本家テーマ形式に accentDarken prop は無いため、静的 fallback のままだと
  //  カスタムテーマの accent 変更にボタン hover 等が追従しない)
  if (compiled.accentDarken === undefined && compiled.accent) {
    compiled.accentDarken = color.darken(compiled.accent, 6)
  }

  return compiled
}
