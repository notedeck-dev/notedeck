// 「AiScript の語彙は grammarTokens が正本で、tmLanguage はそこから生成したものと
// 一致する」を機械検査に落とす (#1050)。
//
// 文法定義は CodeMirror (編集) と tmLanguage (読み取り) の 2 本で、形式が違うので
// 片方から片方は生成しない。代わりにキーワード / 組込の一覧を grammarTokens に
// 置き、CodeMirror は直接 import、tmLanguage は scripts/gen-aiscript-grammar.mjs
// で生成する。ずれたら `pnpm gen:aiscript-grammar` (capabilityDeclarations と同じ
// snapshot 方式)。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AISCRIPT_BUILTINS,
  AISCRIPT_KEYWORDS,
  AISCRIPT_LITERALS,
  AISCRIPT_STORAGE_KEYWORDS,
} from '@/aiscript/grammarTokens'
import { GRAMMAR_PATH, generate } from '../../scripts/gen-aiscript-grammar.mjs'

describe('AiScript の文法 (#1050)', () => {
  const generated = generate()

  it('aiscript.tmLanguage.json は grammarTokens から再生成したものと一致する', () => {
    expect(
      readFileSync(GRAMMAR_PATH, 'utf8'),
      'aiscript.tmLanguage.json が古い — `pnpm gen:aiscript-grammar` を実行してコミットする',
    ).toBe(generated)
  })

  it('生成した tmLanguage は正本の語を全部引いている', () => {
    const grammar = JSON.parse(generated) as {
      repository: Record<string, { patterns: { match?: string }[] }>
    }
    const keywordRe = grammar.repository.keywords?.patterns[0]?.match ?? ''
    const storageRe = grammar.repository.declarations?.patterns[0]?.match ?? ''
    for (const kw of AISCRIPT_KEYWORDS)
      expect(keywordRe).toMatch(new RegExp(`[(|]${kw}[|)]`))
    for (const kw of [...AISCRIPT_STORAGE_KEYWORDS, ...AISCRIPT_LITERALS])
      expect(storageRe).toMatch(new RegExp(`[(|]${kw}[|)]`))
    const builtinRes = (grammar.repository.builtins?.patterns ?? []).map(
      (p) => p.match ?? '',
    )
    for (const [ns, members] of Object.entries(AISCRIPT_BUILTINS)) {
      for (const m of members) {
        expect(
          builtinRes.some((re) => re.includes(`(${ns}):`) && re.includes(m)),
          `${ns}:${m} が tmLanguage に無い`,
        ).toBe(true)
      }
    }
  })
})
