import { describe, expect, it } from 'vitest'
import { formatDuplicateIdNotice } from './duplicateIdNotice'

describe('formatDuplicateIdNotice', () => {
  it('重複が無ければ null', () => {
    expect(formatDuplicateIdNotice([])).toBeNull()
  })

  it('1 件なら ID とファイル名を含む従来の文', () => {
    const msg = formatDuplicateIdNotice([{ id: 'dup', file: 'b.json5' }])
    expect(msg).toContain('「dup」')
    expect(msg).toContain('b.json5 は読み込まれていません')
  })

  it('複数件は 1 本にまとめ、ID ごとにファイルを列挙する', () => {
    const msg = formatDuplicateIdNotice([
      { id: '1', file: '1-2.json5' },
      { id: '1', file: '1-3.json5' },
      { id: '2', file: '2-2.json5' },
    ])
    expect(msg).toContain('3 件')
    expect(msg).toContain('「1」: 1-2.json5, 1-3.json5')
    expect(msg).toContain('「2」: 2-2.json5')
  })
})
