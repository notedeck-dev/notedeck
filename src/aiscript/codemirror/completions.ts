import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import {
  AISCRIPT_BUILTINS,
  AISCRIPT_KEYWORDS,
  AISCRIPT_LITERALS,
  AISCRIPT_STORAGE_KEYWORDS,
  isBuiltinConstant,
} from '@/aiscript/grammarTokens'
import { getSnippetCompletions } from '@/aiscript/snippets/cache'

const keywordCompletions: Completion[] = [
  ...AISCRIPT_KEYWORDS,
  ...AISCRIPT_STORAGE_KEYWORDS,
  ...AISCRIPT_LITERALS,
].map((kw) => ({ label: kw, type: 'keyword' }))

const builtins = AISCRIPT_BUILTINS

// Pre-build namespace member completions
const nsMemberCompletions = new Map<string, Completion[]>()
for (const [ns, members] of Object.entries(builtins)) {
  nsMemberCompletions.set(
    ns,
    members.map((m) => ({
      label: `${ns}:${m}`,
      type: isBuiltinConstant(m) ? 'constant' : 'function',
      detail: ns,
    })),
  )
}

const namespaceCompletions: Completion[] = Object.keys(builtins).map((ns) => ({
  label: ns,
  type: 'namespace',
}))

export function aiscriptCompletions(
  context: CompletionContext,
): CompletionResult | null {
  // Check for namespace:member pattern (e.g., "Mk:" or "Mk:di")
  const nsMatch = context.matchBefore(/[A-Z][a-z]*:[\w]*/)
  if (nsMatch) {
    const colonIdx = nsMatch.text.indexOf(':')
    const ns = nsMatch.text.slice(0, colonIdx)
    const members = nsMemberCompletions.get(ns)
    if (members) {
      return {
        from: nsMatch.from,
        options: members,
        validFor: /^[A-Z][a-z]*:[\w]*$/,
      }
    }
  }

  // General word completion (keywords + namespaces + user snippets)
  const word = context.matchBefore(/\w+/)
  if (!word || (word.from === word.to && !context.explicit)) return null

  return {
    from: word.from,
    options: [
      ...keywordCompletions,
      ...namespaceCompletions,
      ...getSnippetCompletions(),
    ],
    validFor: /^\w*$/,
  }
}
