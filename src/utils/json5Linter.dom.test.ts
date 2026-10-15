// @vitest-environment happy-dom
import {
  type Diagnostic,
  forceLinting,
  forEachDiagnostic,
} from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createJson5Linter } from './json5Linter'

const views: EditorView[] = []

async function lint(doc: string): Promise<Diagnostic[]> {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [createJson5Linter(0)] }),
    parent: document.body,
  })
  views.push(view)
  forceLinting(view)
  // source の結果は Promise 経由で dispatch される
  await new Promise((r) => setTimeout(r, 0))
  const out: Diagnostic[] = []
  forEachDiagnostic(view.state, (d, from, to) => {
    out.push({ ...d, from, to })
  })
  return out
}

describe('createJson5Linter', () => {
  afterEach(() => {
    for (const v of views.splice(0)) v.destroy()
  })

  it('正しい JSON5 (コメント・末尾カンマ・クォート無しキー) なら診断なし', async () => {
    expect(await lint("{\n  // c\n  a: 1,\n  b: 'x',\n}")).toEqual([])
  })

  it('空や空白だけの文書は診断なし', async () => {
    expect(await lint('')).toEqual([])
    expect(await lint('  \n\t')).toEqual([])
  })

  it('構文エラーはエラー位置の行全体に error として付く', async () => {
    const doc = '{\n  a: 1,\n  b: @,\n}'
    const ds = await lint(doc)
    expect(ds).toHaveLength(1)
    const d = ds[0] as Diagnostic
    expect(d.severity).toBe('error')
    expect(d.message).toMatch(/^JSON5: invalid character '@' at 3:\d+$/)
    expect(doc.slice(d.from, d.to)).toBe('  b: @,')
  })

  it('入力途中で終わったら最終行に付く (行番号を文書の行数で丸める)', async () => {
    const doc = '{\n  a: 1,'
    const ds = await lint(doc)
    expect(ds).toHaveLength(1)
    expect(ds[0]?.message).toMatch(/invalid end of input/)
    expect(doc.slice(ds[0]?.from, ds[0]?.to)).toBe('  a: 1,')
  })
})
