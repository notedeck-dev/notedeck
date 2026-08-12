import { afterEach, describe, expect, it } from 'vitest'
import { type App, createApp } from 'vue'
import CodeDiffView from './CodeDiffView.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mountDiff(props: {
  oldText: string
  newText: string
  language?: 'aiscript' | 'json5' | 'markdown' | 'css' | 'text'
  collapseUnchanged?: boolean
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(CodeDiffView, props)
  app.mount(container)
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('CodeDiffView', () => {
  it('old/new の差分から挿入 (changedLine) と削除 (deletedChunk) の装飾を描画する', () => {
    mountDiff({
      oldText: 'line1\nold line\nline3',
      newText: 'line1\nnew line\nline3',
      collapseUnchanged: false,
    })
    // 変更行 (挿入側) の装飾
    expect(container?.querySelector('.cm-changedLine')).toBeTruthy()
    // 削除チャンク (旧テキスト) の装飾と内容
    const deleted = container?.querySelector('.cm-deletedChunk')
    expect(deleted).toBeTruthy()
    expect(deleted?.textContent).toContain('old line')
    // 新テキストが本文として描画される
    expect(container?.textContent).toContain('new line')
  })

  it('差分が無ければ変更装飾を描画しない', () => {
    mountDiff({
      oldText: 'same\ntext',
      newText: 'same\ntext',
      collapseUnchanged: false,
    })
    expect(container?.querySelector('.cm-changedLine')).toBeNull()
    expect(container?.querySelector('.cm-deletedChunk')).toBeNull()
  })

  it('oldText が空 (新規作成) は全行挿入の diff として描画される', () => {
    mountDiff({ oldText: '', newText: 'a\nb', collapseUnchanged: false })
    expect(container?.querySelector('.cm-changedLine')).toBeTruthy()
  })

  it('チャンク承認/拒否の mergeControls は表示しない (読取専用ビュー)', () => {
    mountDiff({
      oldText: 'a',
      newText: 'b',
      collapseUnchanged: false,
    })
    expect(container?.querySelector('.cm-chunkButtons')).toBeNull()
  })

  it('ルート要素に DOM フック用の data 属性と言語を出す', () => {
    mountDiff({ oldText: 'a', newText: 'b', language: 'json5' })
    const root = container?.querySelector('[data-nd-code-diff]')
    expect(root).toBeTruthy()
    expect(root?.getAttribute('data-language')).toBe('json5')
  })
})
