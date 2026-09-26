import { i18n } from '@/i18n'

// 初回生成用テンプレ。TypeScript のテンプレートリテラル補間と衝突するので
// コード中の ${...} は \${...} でエスケープしている。説明文は作る時点の
// 表示言語で入れる (保存後は利用者のファイルなので翻訳し直さない)
export function defaultAiscriptSnippets(): string {
  const desc = (text: string) => JSON.stringify(text)
  const tabStops = i18n.tsx._defaultSnippets.headerTabStops({
    placeholder: `\${1:default}`,
    end: '$0',
  })
  return `// ${i18n.ts._defaultSnippets.headerTitle}
// ${i18n.ts._defaultSnippets.headerSchema}
// ${tabStops}
{
  "Dialog": {
    "prefix": "dlg",
    "body": ["Mk:dialog(\\"$1\\", \\"\${2:message}\\")$0"],
    "description": ${desc(i18n.ts._defaultSnippets.dialog)}
  },
  "For loop": {
    "prefix": "for",
    "body": ["for let \${1:i}, \${2:10} {", "\\t$0", "}"],
    "description": ${desc(i18n.ts._defaultSnippets.forLoop)}
  },
  "Each loop": {
    "prefix": "each",
    "body": ["each let \${1:item}, \${2:arr} {", "\\t$0", "}"],
    "description": ${desc(i18n.ts._defaultSnippets.eachLoop)}
  },
  "API call": {
    "prefix": "api",
    "body": ["Mk:api(\\"\${1:endpoint}\\", {$2})$0"],
    "description": ${desc(i18n.ts._defaultSnippets.apiCall)}
  }
}
`
}
