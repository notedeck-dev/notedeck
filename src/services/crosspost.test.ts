import { describe, expect, it, vi } from 'vitest'
import {
  accountSelectionIssue,
  type ConstraintState,
  type CrosspostAttachment,
  disabledVisibilitiesFromPolicies,
  minMaxTextLength,
  runCrosspost,
} from './crosspost'

function attachment(path: string): CrosspostAttachment {
  return {
    source: { kind: 'path', path },
    meta: { name: path, comment: null, isSensitive: false },
  }
}

describe('runCrosspost', () => {
  it('primary は既存 fileIds をそのまま使い、他アカウントは再アップロードした fileIds で createNote する', async () => {
    const uploadFile = vi.fn(
      async (accountId: string, att: CrosspostAttachment) =>
        `${accountId}:${att.source.kind === 'path' ? att.source.path : 'file'}`,
    )
    const createNote = vi.fn(async () => undefined)
    const results = await runCrosspost(
      {
        targets: [
          { accountId: 'acc1', fileIds: ['f1', 'f2'] },
          { accountId: 'acc2' },
        ],
        attachments: [attachment('a.png'), attachment('b.png')],
        params: { text: 'hello', visibility: 'public' },
      },
      { uploadFile, createNote },
    )
    // primary はアップロードしない
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(uploadFile.mock.calls.every((c) => c[0] === 'acc2')).toBe(true)
    expect(createNote).toHaveBeenCalledWith('acc1', {
      text: 'hello',
      visibility: 'public',
      fileIds: ['f1', 'f2'],
    })
    expect(createNote).toHaveBeenCalledWith('acc2', {
      text: 'hello',
      visibility: 'public',
      fileIds: ['acc2:a.png', 'acc2:b.png'],
    })
    expect(results).toEqual([
      { accountId: 'acc1', ok: true, fileIds: ['f1', 'f2'] },
      { accountId: 'acc2', ok: true, fileIds: ['acc2:a.png', 'acc2:b.png'] },
    ])
  })

  it('添付が無ければ uploadFile を呼ばず fileIds なしで createNote する', async () => {
    const uploadFile = vi.fn()
    const createNote = vi.fn(async () => undefined)
    await runCrosspost(
      {
        targets: [{ accountId: 'acc1' }, { accountId: 'acc2' }],
        attachments: [],
        params: { text: 'x' },
      },
      { uploadFile, createNote },
    )
    expect(uploadFile).not.toHaveBeenCalled()
    expect(createNote).toHaveBeenCalledWith('acc1', {
      text: 'x',
      fileIds: undefined,
    })
  })

  it('全添付のアップロード完了を待ってから createNote する', async () => {
    let resolveUpload: (id: string) => void = () => undefined
    const uploadFile = vi
      .fn()
      .mockImplementationOnce(async () => 'u1')
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveUpload = resolve
          }),
      )
    const createNote = vi.fn(async () => undefined)
    const promise = runCrosspost(
      {
        targets: [{ accountId: 'acc2' }],
        attachments: [attachment('a.png'), attachment('b.png')],
        params: { text: 'x' },
      },
      { uploadFile, createNote },
    )
    await Promise.resolve()
    expect(createNote).not.toHaveBeenCalled()
    resolveUpload('u2')
    await promise
    expect(createNote).toHaveBeenCalledWith('acc2', {
      text: 'x',
      fileIds: ['u1', 'u2'],
    })
  })

  it('アップロード失敗したアカウントは createNote されず uploadFailed で返る (他アカウントは独立)', async () => {
    const uploadFile = vi.fn(async (accountId: string) => {
      if (accountId === 'acc2') throw new Error('upload boom')
      return `${accountId}:up`
    })
    const createNote = vi.fn(async () => undefined)
    const results = await runCrosspost(
      {
        targets: [{ accountId: 'acc2' }, { accountId: 'acc3' }],
        attachments: [attachment('a.png')],
        params: { text: 'x' },
      },
      { uploadFile, createNote },
    )
    expect(createNote).toHaveBeenCalledTimes(1)
    expect(createNote).toHaveBeenCalledWith('acc3', {
      text: 'x',
      fileIds: ['acc3:up'],
    })
    expect(results[0]).toMatchObject({
      accountId: 'acc2',
      ok: false,
      uploadFailed: true,
    })
    expect(results[0]?.error).toContain('upload boom')
    expect(results[1]).toEqual({
      accountId: 'acc3',
      ok: true,
      fileIds: ['acc3:up'],
    })
  })

  it('createNote 失敗は ok=false でアップロード済み fileIds を保持する (draft 救済用)', async () => {
    const uploadFile = vi.fn(async () => 'up1')
    const createNote = vi.fn(async (accountId: string) => {
      if (accountId === 'acc2') throw new Error('create boom')
    })
    const results = await runCrosspost(
      {
        targets: [
          { accountId: 'acc1', fileIds: ['f1'] },
          { accountId: 'acc2' },
        ],
        attachments: [attachment('a.png')],
        params: { text: 'x' },
      },
      { uploadFile, createNote },
    )
    expect(results[0]).toEqual({ accountId: 'acc1', ok: true, fileIds: ['f1'] })
    expect(results[1]).toMatchObject({
      accountId: 'acc2',
      ok: false,
      fileIds: ['up1'],
    })
    expect(results[1]?.uploadFailed).toBeUndefined()
    expect(results[1]?.error).toContain('create boom')
  })
})

describe('disabledVisibilitiesFromPolicies', () => {
  it('can*Note=false の項目を visibility 名に変換する', () => {
    const disabled = disabledVisibilitiesFromPolicies({
      canPublicNote: false,
      canHomeNote: false,
      canScheduleNote: true,
    })
    expect(disabled).toEqual(new Set(['public', 'home']))
  })

  it('false 以外の値は無視する', () => {
    expect(disabledVisibilitiesFromPolicies({ canPublicNote: true })).toEqual(
      new Set(),
    )
    expect(disabledVisibilitiesFromPolicies({})).toEqual(new Set())
  })
})

describe('minMaxTextLength', () => {
  const ready = (max: number): ConstraintState => ({
    status: 'ready',
    maxNoteTextLength: max,
    disabledVisibilities: new Set(),
  })

  it('ready な constraint の最小値を返す', () => {
    expect(minMaxTextLength(3000, [ready(500), ready(1000)])).toBe(500)
  })

  it('loading / error / undefined は無視する (保守側判定は selection issue が担う)', () => {
    expect(
      minMaxTextLength(3000, [
        { status: 'loading' },
        { status: 'error' },
        undefined,
        ready(2000),
      ]),
    ).toBe(2000)
  })

  it('constraint が無ければ default を返す', () => {
    expect(minMaxTextLength(3000, [])).toBe(3000)
  })
})

describe('accountSelectionIssue', () => {
  const ready = (max: number, disabled: string[] = []): ConstraintState => ({
    status: 'ready',
    maxNoteTextLength: max,
    disabledVisibilities: new Set(disabled),
  })

  it('取得中 (undefined / loading) は loading を返す (送信不可に倒す)', () => {
    expect(accountSelectionIssue(undefined, 0, 'public')).toEqual({
      kind: 'loading',
    })
    expect(accountSelectionIssue({ status: 'loading' }, 0, 'public')).toEqual({
      kind: 'loading',
    })
  })

  it('取得失敗は blocked を返す', () => {
    expect(accountSelectionIssue({ status: 'error' }, 0, 'public')).toEqual({
      kind: 'blocked',
      reason: 'サーバー情報を取得できません',
    })
  })

  it('文字数超過は blocked「文字数超過」', () => {
    expect(accountSelectionIssue(ready(500), 501, 'public')).toEqual({
      kind: 'blocked',
      reason: '文字数超過',
    })
    expect(accountSelectionIssue(ready(500), 500, 'public')).toBeNull()
  })

  it('使えない公開範囲は blocked「この公開範囲は使えません」', () => {
    expect(accountSelectionIssue(ready(3000, ['public']), 0, 'public')).toEqual(
      { kind: 'blocked', reason: 'この公開範囲は使えません' },
    )
    expect(accountSelectionIssue(ready(3000, ['public']), 0, 'home')).toBeNull()
  })
})
