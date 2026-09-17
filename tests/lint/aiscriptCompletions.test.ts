// 「NoteDeck 自前の AiScript API はエディタ補完に載っている」を機械検査に落とす (#1098)。
//
// エディタの補完リストは手書きで、監査時点では本家の Mk: / Ui: 等はあるのに
// NoteDeck 独自の Nd: と Plugin: 名前空間が丸ごと無かった。関数を足す側と
// 補完を足す側が別ファイルなので、忘れても何も起きない。
//
// 検査対象は src/aiscript 配下で `consts['Nd:xxx']` / `consts['Plugin:xxx']`
// として登録される関数。Plugin:register:xxx は Plugin:register_xxx の別名
// なので、どちらかが補完にあれば通す。

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AISCRIPT_BUILTIN_COMPLETIONS } from '@/aiscript/codemirror/completions'

const ROOT = resolve(import.meta.dirname, '../..')
const AISCRIPT_DIR = join(ROOT, 'src/aiscript')

function registeredNativeFunctions(): Set<string> {
  const out = new Set<string>()
  for (const entry of readdirSync(AISCRIPT_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts')) continue
    const src = readFileSync(join(AISCRIPT_DIR, entry.name), 'utf-8')
    for (const m of src.matchAll(/consts\['((?:Nd|Plugin):[A-Za-z_:]+)'\]/g)) {
      // Plugin:register:note_action と Plugin:register_note_action は同じ関数
      out.add(m[1].replace(/^Plugin:register:/, 'Plugin:register_'))
    }
  }
  return out
}

describe('AiScript 補完リスト', () => {
  it('Nd: / Plugin: の登録関数は全て補完に載っている', () => {
    const listed = new Set<string>()
    for (const [ns, members] of Object.entries(AISCRIPT_BUILTIN_COMPLETIONS)) {
      for (const m of members) listed.add(`${ns}:${m}`)
    }
    const missing = [...registeredNativeFunctions()]
      .filter((name) => !listed.has(name))
      .sort()
    expect(missing).toEqual([])
  })
})
