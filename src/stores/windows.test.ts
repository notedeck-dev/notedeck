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
