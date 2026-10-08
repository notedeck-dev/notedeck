#!/usr/bin/env node
// AiScript の tmLanguage (読み取り側 = Shiki の文法) を語彙の正本から生成する (#1050)。
//
//   pnpm gen:aiscript-grammar
//
// 正本は src/aiscript/grammarTokens.ts (キーワード / リテラル / 注入定数 / 組込の
// 名前空間とメンバー)。CodeMirror 側の文法は同じモジュールを直接 import するので、
// 語を足すときは grammarTokens を直して本スクリプトを回せば両方に流れる。
// 文法の骨格 (文字列・コメント・関数呼び出しの begin/end など) は形式が違うため
// 生成せず、ここに静的に持つ。
//
// 生成物が最新かは tests/lint/aiscriptGrammar.test.ts が検査する
// (openapi.json / declarations.generated.ts と同じ snapshot 方式)。

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AISCRIPT_BUILTINS,
  AISCRIPT_KEYWORDS,
  AISCRIPT_LITERALS,
  AISCRIPT_PRESET_CONSTANTS,
  AISCRIPT_STORAGE_KEYWORDS,
  isBuiltinConstant,
} from '../src/aiscript/grammarTokens.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const GRAMMAR_PATH = join(ROOT, 'src/assets/aiscript.tmLanguage.json')

/** 正規表現の選択肢。長い語を先に置き、`len` が `length` の頭だけに当たらないようにする */
function alternation(words) {
  return [...words].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).join('|')
}

/**
 * 組込の `Namespace:member` を 1 名前空間 1 パターンで。関数と定数でスコープが違う
 * (定数は Dark+ / Light+ で変数定数の色、関数は関数の色) ので分けて出す
 */
function builtinPatterns() {
  const patterns = []
  for (const [ns, members] of Object.entries(AISCRIPT_BUILTINS)) {
    const constants = members.filter(isBuiltinConstant)
    const functions = members.filter((m) => !isBuiltinConstant(m))
    for (const [scope, words] of [
      ['support.function.aiscript', functions],
      ['variable.other.constant.aiscript', constants],
    ]) {
      if (words.length === 0) continue
      patterns.push({
        match: `\\b(${ns}):(${alternation(words)})\\b`,
        captures: {
          1: { name: 'support.class.aiscript' },
          2: { name: scope },
        },
      })
    }
  }
  return patterns
}

function grammar() {
  return {
    $schema:
      'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'aiscript',
    displayName: 'AiScript',
    aliases: ['is', 'ais', 'AiScript'],
    patterns: [
      { include: '#namespace' },
      { include: '#syntax' },
      { include: '#template-strings' },
    ],
    repository: {
      syntax: {
        patterns: [
          { include: '#comments' },
          { include: '#builtins' },
          { include: '#functions' },
          { include: '#strings' },
          { include: '#declarations' },
          { include: '#numbers' },
          { include: '#keywords' },
          { include: '#operators' },
          { include: '#presets' },
          { include: '#labels' },
          { include: '#variables' },
        ],
      },
      declarations: {
        patterns: [
          {
            name: 'storage.type.aiscript',
            match: `(@|${alternation(AISCRIPT_LITERALS)})|(^#{3}(?= +\\{))|((${alternation(AISCRIPT_STORAGE_KEYWORDS)})(?= +))`,
          },
        ],
      },
      keywords: {
        patterns: [
          {
            name: 'keyword.control.aiscript',
            match: `(${alternation(AISCRIPT_KEYWORDS)}|<:)(?=[\\s(])`,
          },
        ],
      },
      operators: {
        patterns: [
          {
            name: 'keyword.operator.aiscript',
            match:
              '(\\+|\\-|\\*|\\*\\*|\\/|%|<<|>>|&&|\\|\\||\\^|~|<|>|<=|=>|!=|=)',
          },
          { name: 'punctuation.accessor.aiscript', match: '(:|\\.)' },
        ],
      },
      namespace: {
        patterns: [
          {
            name: 'meta.namespaceblock.aiscript',
            match: '^(:{2})\\s?([a-zA-Z0-9_]+)\\s?\\{',
            captures: {
              1: { name: 'storage.type.aiscript' },
              2: { name: 'entity.name.class.aiscript' },
            },
          },
        ],
      },
      builtins: { patterns: builtinPatterns() },
      functions: {
        patterns: [
          {
            name: 'meta.classfunction.aiscript',
            begin:
              '([A-Z][A-Za-z0-9_:]*(?=:):)*((?<=:)[a-zA-Z0-9_]+(?=\\())\\(',
            beginCaptures: {
              1: {
                name: 'meta.classnamechain.aiscript',
                patterns: [
                  { match: ':', name: 'keyword.operator.aiscript' },
                  { name: 'entity.name.class.aiscript', match: '[^:]*' },
                ],
              },
              2: { name: 'entity.name.function.aiscript' },
            },
            patterns: [{ include: '#syntax' }, { include: '#template-strings' }],
            end: '\\)',
          },
          {
            name: 'meta.function.aiscript',
            begin: '[:.]?([a-zA-Z_][a-zA-Z0-9_]*)\\(',
            beginCaptures: { 1: { name: 'entity.name.function.aiscript' } },
            patterns: [{ include: '#syntax' }, { include: '#template-strings' }],
            end: '\\)',
          },
        ],
      },
      strings: {
        patterns: [
          {
            name: 'string.quoted.single.aiscript',
            begin: "'",
            end: "'",
            patterns: [
              {
                name: 'constant.character.escape.aiscript',
                match: '\\\\[\'"\\\\]',
              },
            ],
          },
          {
            name: 'string.quoted.double.aiscript',
            begin: '"',
            end: '"',
            patterns: [
              {
                name: 'constant.character.escape.aiscript',
                match: '\\\\[\'"\\\\]',
              },
            ],
          },
        ],
      },
      'template-strings': {
        patterns: [
          {
            name: 'meta.template-string.aiscript',
            begin: '`',
            beginCaptures: { 0: { name: 'string.other.aiscript' } },
            end: '`',
            endCaptures: { 0: { name: 'string.other.aiscript' } },
            patterns: [
              {
                name: 'constant.character.escape.aiscript',
                match: '\\\\[\'"`\\\\{}]',
              },
              {
                name: 'meta.string-template.aiscript',
                begin: '\\{',
                beginCaptures: { 0: { name: 'entity.name.tag.aiscript' } },
                end: '\\}',
                endCaptures: { 0: { name: 'entity.name.tag.aiscript' } },
                patterns: [{ include: '#syntax' }],
              },
              { name: 'string.other.aiscript', match: '[^`{]+' },
            ],
          },
        ],
      },
      numbers: {
        patterns: [{ name: 'constant.numeric.aiscript', match: '-?[0-9]+' }],
      },
      variables: {
        patterns: [
          {
            name: 'variable.other.readwrite.aiscript',
            match: '[a-zA-Z][a-zA-Z0-9_]*',
          },
        ],
      },
      labels: {
        patterns: [
          { name: 'entity.name.label.aiscript', match: '#[a-zA-Z][a-zA-Z0-9_]*' },
        ],
      },
      presets: {
        patterns: [
          {
            name: 'variable.other.constant.aiscript',
            match: alternation(AISCRIPT_PRESET_CONSTANTS),
          },
          {
            name: 'meta.classconstant.aiscript',
            match: '([A-Z][A-Za-z0-9_:]*(?=:):)*((?<=:)[a-zA-Z0-9_]+)',
            captures: {
              1: {
                name: 'meta.classnamechain.aiscript',
                patterns: [
                  { match: ':', name: 'punctuation.accessor.aiscript' },
                  { name: 'entity.name.class.aiscript', match: '[^:]*' },
                ],
              },
              2: { name: 'variable.other.constant.aiscript' },
            },
          },
        ],
      },
      comments: {
        patterns: [
          { name: 'comment.line.double-slash.aiscript', match: '//.*' },
          { name: 'comment.block.aiscript', begin: '/\\*', end: '\\*/' },
        ],
      },
    },
    scopeName: 'source.aiscript',
  }
}

/** 生成物 (JSON 文字列)。書き込みは isMain 側でだけ行う */
export function generate() {
  return `${JSON.stringify(grammar(), null, '\t')}\n`
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  writeFileSync(GRAMMAR_PATH, generate())
  console.log(`gen-aiscript-grammar: wrote ${GRAMMAR_PATH}`)
}
