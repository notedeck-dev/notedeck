import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWindowsStore } from './windows'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('windows store: drive-file-detail の dedup (#792)', () => {
  it('同一 fileId + accountId では多重に開かない（origin 差でも 1 枚）', () => {
    const store = useWindowsStore()
    const id1 = store.open('drive-file-detail', {
      accountId: 'acc1',
      fileId: 'f1',
      originFolderId: 'folderA',
    })
    const id2 = store.open('drive-file-detail', {
      accountId: 'acc1',
      fileId: 'f1',
      originFolderId: 'folderB',
    })
    expect(id2).toBe(id1)
    expect(store.windows).toHaveLength(1)
  })

  it('fileId または accountId が異なれば別ウィンドウ', () => {
    const store = useWindowsStore()
    store.open('drive-file-detail', { accountId: 'acc1', fileId: 'f1' })
    store.open('drive-file-detail', { accountId: 'acc1', fileId: 'f2' })
    store.open('drive-file-detail', { accountId: 'acc2', fileId: 'f1' })
    expect(store.windows).toHaveLength(3)
  })
})

describe('windows store: 最小化ウィンドウの復元 (#704)', () => {
  it('minimizedWindows は最小化中のものだけを開いた順に並べる', () => {
    const store = useWindowsStore()
    const a = store.open('drive-file-detail', { accountId: 'acc', fileId: 'a' })
    const b = store.open('drive-file-detail', { accountId: 'acc', fileId: 'b' })
    store.open('drive-file-detail', { accountId: 'acc', fileId: 'c' })
    store.toggleMinimize(b)
    store.toggleMinimize(a)
    expect(store.minimizedWindows.map((w) => w.id)).toEqual([a, b])
  })

  it('restore は最小化を解いて最前面に出す', () => {
    const store = useWindowsStore()
    const a = store.open('drive-file-detail', { accountId: 'acc', fileId: 'a' })
    store.open('drive-file-detail', { accountId: 'acc', fileId: 'b' })
    store.toggleMinimize(a)
    store.restore(a)
    const win = store.windows.find((w) => w.id === a)
    expect(win?.minimized).toBe(false)
    expect(store.topWindow?.id).toBe(a)
  })
})
