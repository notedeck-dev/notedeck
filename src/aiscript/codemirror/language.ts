import { StreamLanguage, type StreamParser } from '@codemirror/language'
import {
  AISCRIPT_KEYWORDS,
  AISCRIPT_LITERALS,
  AISCRIPT_NAMESPACES,
  AISCRIPT_STORAGE_KEYWORDS,
} from '@/aiscript/grammarTokens'

interface AiScriptState {
  inBlockComment: boolean
  inTemplate: boolean
}

// 語彙は grammarTokens が正本 (tmLanguage 側も同じ一覧から生成される #1050)
const keywords = new Set<string>([
  ...AISCRIPT_KEYWORDS,
  ...AISCRIPT_STORAGE_KEYWORDS,
])

const atoms = new Set<string>(AISCRIPT_LITERALS)

const namespaces = new Set(AISCRIPT_NAMESPACES)

const aiscriptParser: StreamParser<AiScriptState> = {
  startState(): AiScriptState {
    return { inBlockComment: false, inTemplate: false }
  },

  token(stream, state): string | null {
    // Block comment continuation
    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false
      } else {
        stream.next()
      }
      return 'comment'
    }

    // Template string continuation
    if (state.inTemplate) {
      if (stream.match('`')) {
        state.inTemplate = false
        return 'string'
      }
      // Template interpolation {expr}
      if (stream.match('{')) {
        return 'string'
      }
      stream.next()
      return 'string'
    }

    // Skip whitespace
    if (stream.eatSpace()) return null

    // Line comment
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }

    // Block comment start
    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }

    // Output operator <:
    if (stream.match('<:')) {
      return 'operator'
    }

    // Strings
    if (stream.match('"')) {
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\') {
          stream.next()
        } else if (ch === '"') {
          return 'string'
        }
      }
      return 'string'
    }

    if (stream.match("'")) {
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\') {
          stream.next()
        } else if (ch === "'") {
          return 'string'
        }
      }
      return 'string'
    }

    // Template string
    if (stream.match('`')) {
      state.inTemplate = true
      return 'string'
    }

    // Numbers
    if (stream.match(/^0x[0-9a-fA-F]+/) || stream.match(/^\d+\.?\d*/)) {
      return 'number'
    }

    // Function definition @name
    if (stream.match(/@[a-zA-Z_]\w*/)) {
      return 'def'
    }

    // Multi-char operators
    if (
      stream.match('==') ||
      stream.match('!=') ||
      stream.match('<=') ||
      stream.match('>=') ||
      stream.match('&&') ||
      stream.match('||') ||
      stream.match('+=') ||
      stream.match('-=') ||
      stream.match('=>')
    ) {
      return 'operator'
    }

    // Single-char operators
    if (stream.match(/^[+\-*/%=<>!?|&^~]/)) {
      return 'operator'
    }

    // Identifiers, keywords, namespaces
    if (stream.match(/^[a-zA-Z_]\w*/)) {
      const word = stream.current()

      // Namespace:member pattern
      if (namespaces.has(word) && stream.peek() === ':') {
        return 'namespace'
      }

      if (keywords.has(word)) return 'keyword'
      if (atoms.has(word)) return 'atom'
      return 'variableName'
    }

    // Brackets, punctuation
    if (stream.match(/^[{}()[\]]/)) {
      return 'bracket'
    }

    if (stream.match(/^[;,.:]/)) {
      return 'punctuation'
    }

    // Anything else
    stream.next()
    return null
  },
}

export const aiscriptLanguage = StreamLanguage.define(aiscriptParser)
