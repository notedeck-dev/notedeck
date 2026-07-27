import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type EffectScope, effectScope, nextTick } from 'vue'

const onPostedMock = vi.fn()
const createNoteMock = vi.fn()
const updateNoteMock = vi.fn()
const getNoteMock = vi.fn()
const initAdapterForMock = vi.fn()
const saveDraftMock = vi.fn()
const deleteDraftMock = vi.fn()
const saveMemoMock = vi.fn()
const deleteMemoMock = vi.fn()
const generateMemoKeyMock = vi.fn()
const detectAvailableTimelinesMock = vi.fn()
const apiGetUserPoliciesMock = vi.fn()
const apiGetSelfMock = vi.fn()
const apiGetMetaDetailMock = vi.fn()
const confirmWithActionMock = vi.fn()
const toastShowMock = vi.fn()
const showLoginPromptMock = vi.fn()
const settingsSetMock = vi.fn()

const settingsData: Record<string, unknown> = {}
const accountsState: { accounts: Account[] } = { accounts: [] }

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => accountsState,
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get: (key: string) => settingsData[key],
    set: (key: string, value: unknown) => {
      settingsData[key] = value
      settingsSetMock(key, value)
    },
  }),
}))
vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ getStyleVarsForAccount: () => ({}) }),
}))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({
    confirmWithAction: (opts: unknown) => confirmWithActionMock(opts),
  }),
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: (...a: unknown[]) => toastShowMock(...a) }),
}))
vi.mock('@/composables/useLoginPrompt', () => ({
  showLoginPrompt: () => showLoginPromptMock(),
}))
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: (...a: unknown[]) => initAdapterForMock(...a),
}))
vi.mock('@/aiscript/plugin-api', () => ({
  applyNotePostInterruptors: (form: unknown) => form,
}))
vi.mock('@/composables/useDrafts', () => ({
  saveDraft: (...a: unknown[]) => saveDraftMock(...a),
  deleteDraft: (...a: unknown[]) => deleteDraftMock(...a),
}))
vi.mock('@/composables/useMemos', () => ({
  generateMemoKey: () => generateMemoKeyMock(),
  ensureMemosLoaded: async () => undefined,
  saveMemo: (...a: unknown[]) => saveMemoMock(...a),
  deleteMemo: (...a: unknown[]) => deleteMemoMock(...a),
}))
vi.mock('@/utils/customTimelines', () => ({
  CUSTOM_TL_ICONS: {},
  detectAvailableTimelines: (...a: unknown[]) =>
    detectAvailableTimelinesMock(...a),
}))
vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiGetUserPolicies: (...a: unknown[]) => apiGetUserPoliciesMock(...a),
      apiGetSelf: (...a: unknown[]) => apiGetSelfMock(...a),
      apiGetMetaDetail: (...a: unknown[]) => apiGetMetaDetailMock(...a),
    },
  }
})

import type {
  NormalizedDriveFile,
  NormalizedNote,
  NoteVisibility,
} from '@/adapters/types'
import { MAX_TEXT_LENGTH } from '@/composables/postFormConstants'
import type { StoredDraft } from '@/composables/useDrafts'
import { usePostFormState } from '@/composables/usePostFormState'
import type { Account } from '@/stores/accounts'

function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'acc1',
    host: 'misskey.test',
    userId: 'u1',
    username: 'taka',
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
    ...over,
  }
}

function makeFile(id: string): NormalizedDriveFile {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    url: `https://example.test/${id}`,
    thumbnailUrl: null,
    size: 1,
    isSensitive: false,
    comment: null,
    width: null,
    height: null,
    blurhash: null,
  }
}

function makeNote(over: Partial<NormalizedNote> = {}): NormalizedNote {
  return { id: 'n1', visibility: 'public', ...over } as NormalizedNote
}

function makeStoredDraft(over: Partial<StoredDraft> = {}): StoredDraft {
  return {
    id: 'd9',
    updatedAt: '2026-07-01T00:00:00Z',
    data: {
      text: '復元テキスト',
      cw: '注意',
      showCw: true,
      visibility: 'followers' as NoteVisibility,
      localOnly: true,
      fileIds: ['f1'],
      pollChoices: ['a', 'b'],
      pollMultiple: true,
      showPoll: true,
      scheduledAt: null,
    },
    replyId: null,
    renoteId: null,
    channelId: null,
    hashtag: null,
    ...over,
  }
}

const ok = (data: unknown) => ({ status: 'ok', data })

type FormProps = Parameters<typeof usePostFormState>[0]
type FormOptions = Parameters<typeof usePostFormState>[2]

let scope: EffectScope | null = null

function mount(props: Partial<FormProps> = {}, options?: FormOptions) {
  scope = effectScope()
  const form = scope.run(() =>
    usePostFormState(
      { accountId: 'acc1', ...props },
      { onPosted: onPostedMock },
      options,
    ),
  )
  if (!form) throw new Error('scope.run failed')
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(settingsData)) delete settingsData[key]
  accountsState.accounts = [makeAccount()]
  detectAvailableTimelinesMock.mockResolvedValue({
    available: [],
    denied: new Set(),
    modes: {},
  })
  apiGetUserPoliciesMock.mockResolvedValue(ok({}))
  apiGetSelfMock.mockResolvedValue(ok({}))
  apiGetMetaDetailMock.mockResolvedValue(ok({}))
  createNoteMock.mockResolvedValue({})
  updateNoteMock.mockResolvedValue({})
  getNoteMock.mockResolvedValue(makeNote({ id: 'q1', text: '引用元' }))
  initAdapterForMock.mockImplementation(async () => ({
    adapter: {
      api: {
        createNote: createNoteMock,
        updateNote: updateNoteMock,
        getNote: getNoteMock,
      },
    },
    serverInfo: { features: { scheduledNotes: false } },
  }))
  saveDraftMock.mockResolvedValue(makeStoredDraft({ id: 'd1' }))
  let memoSeq = 0
  generateMemoKeyMock.mockImplementation(() => {
    memoSeq += 1
    return `memo-${memoSeq}`
  })
})

afterEach(() => {
  scope?.stop()
  scope = null
})

describe('canPost / remainingChars', () => {
  it('空フォーム・空白のみでは投稿できない', () => {
    const form = mount()
    expect(form.canPost.value).toBe(false)
    form.text.value = '   '
    expect(form.canPost.value).toBe(false)
  })

  it('テキストがあれば投稿できる', () => {
    const form = mount()
    form.text.value = 'こんにちは'
    expect(form.canPost.value).toBe(true)
  })

  it('文字数上限を超えると投稿できない', () => {
    const form = mount()
    form.text.value = 'a'.repeat(MAX_TEXT_LENGTH)
    expect(form.remainingChars.value).toBe(0)
    expect(form.canPost.value).toBe(true)
    form.text.value = 'a'.repeat(MAX_TEXT_LENGTH + 1)
    expect(form.remainingChars.value).toBe(-1)
    expect(form.canPost.value).toBe(false)
  })

  it('renoteId があればテキスト無しでも投稿できる', () => {
    const form = mount({ renoteId: 'rn1' })
    expect(form.canPost.value).toBe(true)
  })

  it('ファイル添付があればテキスト無しでも投稿できる', () => {
    const form = mount()
    form.attachedFiles.value = [makeFile('f1')]
    expect(form.canPost.value).toBe(true)
  })

  it('投票は有効な選択肢が 2 つ以上で投稿できる', () => {
    const form = mount()
    form.showPoll.value = true
    form.pollChoices.value = ['A', ' ']
    expect(form.canPost.value).toBe(false)
    form.pollChoices.value = ['A', 'B']
    expect(form.canPost.value).toBe(true)
  })
})

describe('アンケート期限', () => {
  async function mountWithPoll() {
    const form = mount()
    await form.initAdapter()
    form.showPoll.value = true
    form.pollChoices.value = ['A', 'B']
    return form
  }

  it('期間指定 (pollExpiredAfter) は投稿時に絶対時刻へ変換される', async () => {
    const form = await mountWithPoll()
    form.pollExpiredAfter.value = 3_600_000
    const before = Date.now()
    await form.post()
    const after = Date.now()
    const poll = createNoteMock.mock.calls[0]?.[0]?.poll
    expect(poll.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(poll.expiresAt).toBeLessThanOrEqual(after + 3_600_000)
  })

  it('日時指定 (pollExpiresAt) はそのまま送信される', async () => {
    const form = await mountWithPoll()
    form.pollExpiresAt.value = 1_800_000_000_000
    await form.post()
    const poll = createNoteMock.mock.calls[0]?.[0]?.poll
    expect(poll.expiresAt).toBe(1_800_000_000_000)
  })

  it('期限未指定なら expiresAt を送らない (無期限)', async () => {
    const form = await mountWithPoll()
    await form.post()
    const poll = createNoteMock.mock.calls[0]?.[0]?.poll
    expect(poll.expiresAt).toBeUndefined()
  })

  it('resetForm で期限もリセットされる', async () => {
    const form = await mountWithPoll()
    form.pollExpiredAfter.value = 60_000
    form.pollExpiresAt.value = 1_800_000_000_000
    form.resetForm()
    expect(form.pollExpiredAfter.value).toBeNull()
    expect(form.pollExpiresAt.value).toBeNull()
  })
})

describe('引用プレビュー', () => {
  it('renoteId があれば initAdapter で引用元ノートを取得する', async () => {
    const form = mount({ renoteId: 'q1' })
    await form.initAdapter()
    expect(getNoteMock).toHaveBeenCalledWith('q1')
    expect(form.quoteNote.value?.id).toBe('q1')
  })

  it('renoteId が無ければ取得しない', async () => {
    const form = mount()
    await form.initAdapter()
    expect(getNoteMock).not.toHaveBeenCalled()
    expect(form.quoteNote.value).toBeNull()
  })

  it('取得失敗時は quoteNote が null のまま (インジケータへフォールバック)', async () => {
    getNoteMock.mockRejectedValue(new Error('not found'))
    const form = mount({ renoteId: 'q1' })
    await form.initAdapter()
    expect(form.quoteNote.value).toBeNull()
    expect(form.error.value).toBeNull()
  })
})

describe('文字数上限のサーバー同期', () => {
  it('meta の maxNoteTextLength が remainingChars に反映される', async () => {
    apiGetMetaDetailMock.mockResolvedValue(ok({ maxNoteTextLength: 500 }))
    const form = mount()
    await form.initAdapter()
    expect(form.maxTextLength.value).toBe(500)
    form.text.value = 'a'.repeat(501)
    expect(form.remainingChars.value).toBe(-1)
    expect(form.canPost.value).toBe(false)
  })

  it('meta に maxNoteTextLength が無ければデフォルト値のまま', async () => {
    apiGetMetaDetailMock.mockResolvedValue(ok({}))
    const form = mount()
    await form.initAdapter()
    expect(form.maxTextLength.value).toBe(MAX_TEXT_LENGTH)
  })

  it('meta 取得失敗でもデフォルト値で動作する', async () => {
    apiGetMetaDetailMock.mockRejectedValue(new Error('network'))
    const form = mount()
    await form.initAdapter()
    expect(form.maxTextLength.value).toBe(MAX_TEXT_LENGTH)
  })
})

describe('initAdapter', () => {
  it('canPublicNote=false ポリシーで public が無効化され visibility が補正される', async () => {
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canPublicNote: false }))
    const form = mount()
    await form.initAdapter()
    expect(form.disabledVisibilities.value.has('public')).toBe(true)
    expect(form.visibility.value).toBe('home')
  })

  it('specified への返信では public/home が無効化される', async () => {
    const form = mount({
      replyTo: makeNote({ id: 'r1', visibility: 'specified' }),
    })
    await form.initAdapter()
    expect(form.disabledVisibilities.value.has('public')).toBe(true)
    expect(form.disabledVisibilities.value.has('home')).toBe(true)
    expect(form.visibility.value).toBe('followers')
  })

  it('サーバーの defaultNoteVisibility / defaultNoteLocalOnly を反映する', async () => {
    apiGetSelfMock.mockResolvedValue(
      ok({ defaultNoteVisibility: 'followers', defaultNoteLocalOnly: true }),
    )
    const form = mount()
    await form.initAdapter()
    expect(form.visibility.value).toBe('followers')
    expect(form.localOnly.value).toBe(true)
  })

  it('rememberVisibility ON で前回のアカウント別 visibility/localOnly を復元する', async () => {
    settingsData['postForm.rememberVisibility'] = true
    settingsData['postForm.lastUsedVisibilityByAccount'] = { acc1: 'followers' }
    settingsData['postForm.lastUsedLocalOnlyByAccount'] = { acc1: true }
    const form = mount()
    await form.initAdapter()
    expect(form.visibility.value).toBe('followers')
    expect(form.localOnly.value).toBe(true)
  })

  it('返信フォームでは rememberVisibility の記憶値を適用しない', async () => {
    settingsData['postForm.rememberVisibility'] = true
    settingsData['postForm.lastUsedVisibilityByAccount'] = { acc1: 'followers' }
    const form = mount({ replyTo: makeNote({ id: 'r1' }) })
    await form.initAdapter()
    expect(form.visibility.value).toBe('public')
  })

  it('mode フラグは isIn→isNoteIn に変換され can*Note=false でフィルタされる', async () => {
    detectAvailableTimelinesMock.mockResolvedValue({
      available: [],
      denied: new Set(),
      modes: {
        isInYamiMode: true,
        isInBubbleMode: true,
        isInHiddenMode: false,
      },
    })
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canBubbleNote: false }))
    const form = mount()
    await form.initAdapter()
    expect(form.noteModeFlags.value).toEqual({ isNoteInYamiMode: true })
    expect(form.disabledVisibilities.value.has('bubble')).toBe(true)
  })

  it('adapter 初期化失敗時は error を設定し supportsScheduledNotes false', async () => {
    initAdapterForMock.mockRejectedValueOnce(new Error('server down'))
    const form = mount()
    await form.initAdapter()
    expect(form.error.value).toBeTruthy()
    expect(form.supportsScheduledNotes.value).toBe(false)
  })

  it('channelId があると localOnly は初期 true のまま維持される', async () => {
    apiGetSelfMock.mockResolvedValue(ok({ defaultNoteLocalOnly: false }))
    const form = mount({ channelId: 'ch1' })
    expect(form.localOnly.value).toBe(true)
    await form.initAdapter()
    expect(form.localOnly.value).toBe(true)
  })
})

describe('post: 新規ノート', () => {
  it('ペイロードを組み立てて createNote し、楽観的にフォームを閉じる', async () => {
    const form = mount()
    await form.initAdapter()
    form.text.value = 'hello'
    form.cw.value = 'ネタバレ'
    form.showCw.value = true
    form.visibility.value = 'home'
    form.localOnly.value = true
    form.showPoll.value = true
    form.pollChoices.value = ['A', ' ', 'B']
    form.pollMultiple.value = true
    form.pollExpiresAt.value = 12345
    // API が未解決でもフォームは閉じる (楽観的 UI)
    createNoteMock.mockImplementationOnce(
      () =>
        new Promise(() => {
          // 意図的に未解決のまま (楽観的クローズの検証)
        }),
    )
    await form.post()
    expect(createNoteMock).toHaveBeenCalledWith({
      text: 'hello',
      cw: 'ネタバレ',
      visibility: 'home',
      localOnly: true,
      modeFlags: undefined,
      replyId: undefined,
      renoteId: undefined,
      channelId: undefined,
      fileIds: undefined,
      poll: { choices: ['A', 'B'], multiple: true, expiresAt: 12345 },
      scheduledAt: undefined,
    })
    expect(form.posted.value).toBe(true)
    expect(form.isPosting.value).toBe(false)
    expect(onPostedMock).toHaveBeenCalledTimes(1)
  })

  it('specified では localOnly を強制的に false で送る', async () => {
    const form = mount()
    await form.initAdapter()
    form.text.value = 'dm'
    form.visibility.value = 'specified'
    form.localOnly.value = true
    await form.post()
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'specified', localOnly: false }),
    )
  })

  it('showCw が OFF なら cw テキストがあっても送信しない', async () => {
    const form = mount()
    await form.initAdapter()
    form.text.value = 'x'
    form.cw.value = '残骸'
    form.showCw.value = false
    await form.post()
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ cw: undefined }),
    )
  })

  it('返信/リノート/チャネル/添付ファイル ID を送信する', async () => {
    const form = mount({
      replyTo: makeNote({ id: 'r1' }),
      renoteId: 'rn1',
      channelId: 'ch1',
    })
    await form.initAdapter()
    form.attachedFiles.value = [makeFile('f1'), makeFile('f2')]
    await form.post()
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        replyId: 'r1',
        renoteId: 'rn1',
        channelId: 'ch1',
        fileIds: ['f1', 'f2'],
      }),
    )
  })

  it('adapter 未初期化・canPost false では何もしない', async () => {
    const form = mount()
    form.text.value = 'x'
    await form.post() // adapter null
    await form.initAdapter()
    await form.post() // canPost true → 投稿される
    form.text.value = ''
    form.posted.value = false
    await form.post() // canPost false
    expect(createNoteMock).toHaveBeenCalledTimes(1)
  })

  it('トークン無しアカウントはログインプロンプトを出して入力を保持する', async () => {
    accountsState.accounts = [makeAccount({ hasToken: false })]
    const form = mount()
    await form.initAdapter()
    form.text.value = '消えてはいけない'
    await form.post()
    expect(showLoginPromptMock).toHaveBeenCalledTimes(1)
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(form.text.value).toBe('消えてはいけない')
    expect(form.posted.value).toBe(false)
  })

  it('送信失敗時は toast 通知して下書きに退避する', async () => {
    createNoteMock.mockRejectedValueOnce(new Error('boom'))
    const form = mount()
    await form.initAdapter()
    form.text.value = '救出対象'
    await form.post()
    // 楽観的に閉じた後、バックグラウンド失敗 → draft 退避
    expect(form.posted.value).toBe(true)
    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(1))
    expect(toastShowMock).toHaveBeenCalled()
    expect(saveDraftMock).toHaveBeenCalledWith(
      'acc1',
      null,
      expect.objectContaining({ text: '救出対象' }),
      { replyId: null, renoteId: null, channelId: null },
    )
  })

  it('rememberVisibility ON なら送信した visibility/localOnly を per-account で記憶する', async () => {
    settingsData['postForm.rememberVisibility'] = true
    const form = mount()
    await form.initAdapter()
    form.text.value = 'x'
    form.visibility.value = 'home'
    form.localOnly.value = true
    await form.post()
    expect(settingsSetMock).toHaveBeenCalledWith(
      'postForm.lastUsedVisibilityByAccount',
      { acc1: 'home' },
    )
    expect(settingsSetMock).toHaveBeenCalledWith(
      'postForm.lastUsedLocalOnlyByAccount',
      { acc1: true },
    )
  })
})

describe('post: 迷惑投稿チェック', () => {
  it('public + $[x2 で確認を出し「ホームに投稿」で home に切り替える', async () => {
    confirmWithActionMock.mockResolvedValue('home')
    const form = mount()
    await form.initAdapter()
    form.text.value = '$[x2 でかい]'
    await form.post()
    expect(confirmWithActionMock).toHaveBeenCalledTimes(1)
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'home' }),
    )
  })

  it('確認をキャンセルすると投稿しない', async () => {
    confirmWithActionMock.mockResolvedValue(null)
    const form = mount()
    await form.initAdapter()
    form.text.value = '$[scale.x=5 ぐにゃ]'
    await form.post()
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(form.posted.value).toBe(false)
  })

  it('CW があれば本文の MFM は警告対象にしない (CW テキスト側を判定)', async () => {
    const form = mount()
    await form.initAdapter()
    form.text.value = '$[x2 でかい]'
    form.showCw.value = true
    form.cw.value = 'ふつうの注釈'
    await form.post()
    expect(confirmWithActionMock).not.toHaveBeenCalled()
    expect(createNoteMock).toHaveBeenCalledTimes(1)
  })
})

describe('post: 編集モード', () => {
  it('updateNote を await し editedNoteId 付きで onPosted する', async () => {
    const form = mount({ editNote: makeNote({ id: 'edit1' }) })
    await form.initAdapter()
    form.text.value = '編集後'
    await form.post()
    expect(updateNoteMock).toHaveBeenCalledWith('edit1', {
      text: '編集後',
      cw: undefined,
    })
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(onPostedMock).toHaveBeenCalledWith('edit1')
    expect(form.posted.value).toBe(true)
  })

  it('編集失敗時は error を設定してフォームを閉じない', async () => {
    updateNoteMock.mockRejectedValueOnce(new Error('denied'))
    const form = mount({ editNote: makeNote({ id: 'edit1' }) })
    await form.initAdapter()
    form.text.value = '編集後'
    await form.post()
    expect(form.error.value).toBeTruthy()
    expect(form.posted.value).toBe(false)
    expect(form.isPosting.value).toBe(false)
  })
})

describe('post: 予約投稿', () => {
  it('scheduledNotes 対応サーバーでは draft API 経由で予約する', async () => {
    initAdapterForMock.mockResolvedValueOnce({
      adapter: {
        api: { createNote: createNoteMock, updateNote: updateNoteMock },
      },
      serverInfo: { features: { scheduledNotes: true } },
    })
    const form = mount()
    await form.initAdapter()
    expect(form.supportsScheduledNotes.value).toBe(true)
    form.text.value = '未来の投稿'
    form.scheduledAt.value = '2026-08-01T00:00:00Z'
    await form.post()
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(saveDraftMock).toHaveBeenCalledWith(
      'acc1',
      null,
      expect.objectContaining({
        text: '未来の投稿',
        scheduledAt: '2026-08-01T00:00:00Z',
        isActuallyScheduled: true,
      }),
      { replyId: null, renoteId: null, channelId: null },
    )
    expect(form.posted.value).toBe(true)
  })

  it('非対応サーバーでは scheduledAt 付きで notes/create にフォールバックする', async () => {
    const form = mount()
    await form.initAdapter()
    form.text.value = 'x'
    form.scheduledAt.value = '2026-08-01T00:00:00Z'
    await form.post()
    expect(saveDraftMock).not.toHaveBeenCalled()
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: '2026-08-01T00:00:00Z' }),
    )
  })
})

describe('memo モード', () => {
  it('initAdapter はサーバーに触らない', async () => {
    const form = mount({}, { memoMode: true })
    await form.initAdapter()
    expect(initAdapterForMock).not.toHaveBeenCalled()
    expect(apiGetUserPoliciesMock).not.toHaveBeenCalled()
  })

  it('post はローカル保存してフォームをリセットし新しい key を採番する', async () => {
    const form = mount({}, { memoMode: true })
    await form.initAdapter()
    expect(form.sessionSlotKey.value).toBe('memo-1')
    form.text.value = 'めも'
    await form.post()
    expect(saveMemoMock).toHaveBeenCalledWith(
      'acc1',
      'memo-1',
      expect.objectContaining({ text: 'めも', tags: [] }),
    )
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(form.text.value).toBe('')
    expect(form.sessionSlotKey.value).toBe('memo-2')
    expect(form.posted.value).toBe(true)
    expect(onPostedMock).toHaveBeenCalledTimes(1)
  })

  it('removeCurrentSlot は deleteMemo を呼ぶ', async () => {
    const form = mount({}, { memoMode: true })
    await form.removeCurrentSlot()
    expect(deleteMemoMock).toHaveBeenCalledWith('acc1', 'memo-1')
  })
})

describe('saveCurrentSlot (draft)', () => {
  it('初回は create、以後は同じ draftId へ update する', async () => {
    const form = mount()
    form.text.value = '下書き'
    await form.saveCurrentSlot()
    expect(form.sessionSlotKey.value).toBe('d1')
    await form.saveCurrentSlot()
    expect(saveDraftMock).toHaveBeenCalledTimes(2)
    expect(saveDraftMock.mock.calls[0]?.[1]).toBeNull()
    expect(saveDraftMock.mock.calls[1]?.[1]).toBe('d1')
  })

  it('create 中の並行呼び出しは重複 create せず update に合流する', async () => {
    let resolveCreate: (v: StoredDraft) => void = () => undefined
    saveDraftMock.mockImplementationOnce(
      () =>
        new Promise<StoredDraft>((resolve) => {
          resolveCreate = resolve
        }),
    )
    const form = mount()
    form.text.value = 'x'
    const first = form.saveCurrentSlot()
    const second = form.saveCurrentSlot()
    resolveCreate(makeStoredDraft({ id: 'd1' }))
    await Promise.all([first, second])
    expect(saveDraftMock).toHaveBeenCalledTimes(2)
    expect(saveDraftMock.mock.calls[0]?.[1]).toBeNull()
    expect(saveDraftMock.mock.calls[1]?.[1]).toBe('d1')
  })

  it('create 失敗時は error を設定し、次回はまた create を試みる', async () => {
    saveDraftMock.mockRejectedValueOnce(new Error('fail'))
    const form = mount()
    form.text.value = 'x'
    await form.saveCurrentSlot()
    expect(form.error.value).toBeTruthy()
    expect(form.sessionSlotKey.value).toBeNull()
    await form.saveCurrentSlot()
    expect(saveDraftMock.mock.calls[1]?.[1]).toBeNull()
    expect(form.sessionSlotKey.value).toBe('d1')
  })
})

describe('restoreSlot / removeCurrentSlot', () => {
  it('保存済み draft の内容を復元し draftId を引き継ぐ', () => {
    const form = mount()
    form.restoreSlot(makeStoredDraft())
    expect(form.text.value).toBe('復元テキスト')
    expect(form.cw.value).toBe('注意')
    expect(form.showCw.value).toBe(true)
    expect(form.visibility.value).toBe('followers')
    expect(form.localOnly.value).toBe(true)
    expect(form.pollChoices.value).toEqual(['a', 'b'])
    expect(form.pollMultiple.value).toBe(true)
    expect(form.showPoll.value).toBe(true)
    expect(form.sessionSlotKey.value).toBe('d9')
    // 添付ファイルは復元しない (ID 失効の可能性)
    expect(form.attachedFiles.value).toEqual([])
  })

  it('選択肢が 2 未満の投票データは空の 2 択に正規化する', () => {
    const form = mount()
    const stored = makeStoredDraft()
    stored.data.pollChoices = ['a']
    form.restoreSlot(stored)
    expect(form.pollChoices.value).toEqual(['', ''])
  })

  it('明示 key があれば stored.id より優先する', () => {
    const form = mount()
    form.restoreSlot(makeStoredDraft(), 'explicit-key')
    expect(form.sessionSlotKey.value).toBe('explicit-key')
  })

  it('removeCurrentSlot: key 未確定なら何もしない、復元後は deleteDraft する', async () => {
    const form = mount()
    await form.removeCurrentSlot()
    expect(deleteDraftMock).not.toHaveBeenCalled()
    form.restoreSlot(makeStoredDraft())
    await form.removeCurrentSlot()
    expect(deleteDraftMock).toHaveBeenCalledWith('acc1', 'd9')
  })
})

describe('auto-save watch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('autoSaveDraft ON: 入力から 800ms debounce で保存する (連続入力は 1 回)', async () => {
    settingsData['postForm.autoSaveDraft'] = true
    const form = mount()
    form.text.value = 'a'
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    form.text.value = 'ab'
    await nextTick()
    await vi.advanceTimersByTimeAsync(800)
    expect(saveDraftMock).toHaveBeenCalledTimes(1)
    expect(saveDraftMock).toHaveBeenCalledWith(
      'acc1',
      null,
      expect.objectContaining({ text: 'ab' }),
      { replyId: null, renoteId: null, channelId: null },
    )
  })

  it('autoSaveDraft OFF: 保存しない', async () => {
    const form = mount()
    form.text.value = 'a'
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(saveDraftMock).not.toHaveBeenCalled()
  })

  it('内容が空のままの変更 (CW トグルのみ等) は保存しない', async () => {
    settingsData['postForm.autoSaveDraft'] = true
    const form = mount()
    form.showCw.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(saveDraftMock).not.toHaveBeenCalled()
  })

  it('memo モードは autoSaveMemo トグルで saveMemo する', async () => {
    settingsData['postForm.autoSaveMemo'] = true
    const form = mount({}, { memoMode: true })
    form.text.value = 'めも'
    await nextTick()
    await vi.advanceTimersByTimeAsync(800)
    expect(saveMemoMock).toHaveBeenCalledWith(
      'acc1',
      'memo-1',
      expect.objectContaining({ text: 'めも' }),
    )
    expect(saveDraftMock).not.toHaveBeenCalled()
  })
})

describe('フォーム操作', () => {
  it('resetForm は全フィールドを初期化する', () => {
    const form = mount()
    form.text.value = 'x'
    form.cw.value = 'c'
    form.showCw.value = true
    form.attachedFiles.value = [makeFile('f1')]
    form.showPoll.value = true
    form.pollChoices.value = ['a', 'b', 'c']
    form.pollMultiple.value = true
    form.pollExpiresAt.value = 1
    form.scheduledAt.value = '2026-08-01T00:00:00Z'
    form.error.value = 'e'
    form.resetForm()
    expect(form.text.value).toBe('')
    expect(form.cw.value).toBe('')
    expect(form.showCw.value).toBe(false)
    expect(form.attachedFiles.value).toEqual([])
    expect(form.showPoll.value).toBe(false)
    expect(form.pollChoices.value).toEqual(['', ''])
    expect(form.pollMultiple.value).toBe(false)
    expect(form.pollExpiresAt.value).toBeNull()
    expect(form.scheduledAt.value).toBeNull()
    expect(form.error.value).toBeNull()
  })

  it('投票の選択肢は 2〜10 個の範囲でのみ増減できる', () => {
    const form = mount()
    form.removePollChoice(0)
    expect(form.pollChoices.value).toEqual(['', ''])
    for (let i = 0; i < 12; i++) form.addPollChoice()
    expect(form.pollChoices.value).toHaveLength(10)
    form.removePollChoice(0)
    expect(form.pollChoices.value).toHaveLength(9)
  })

  it('selectVisibility は visibility を変えメニューを閉じる', () => {
    const form = mount()
    form.showVisibilityMenu.value = true
    form.selectVisibility('followers')
    expect(form.visibility.value).toBe('followers')
    expect(form.showVisibilityMenu.value).toBe(false)
  })

  it('switchAccount は activeAccountId を切り替えて再初期化する', async () => {
    accountsState.accounts = [makeAccount(), makeAccount({ id: 'acc2' })]
    const form = mount()
    await form.initAdapter()
    initAdapterForMock.mockClear()
    await form.switchAccount('acc2')
    expect(form.activeAccountId.value).toBe('acc2')
    expect(form.account.value?.id).toBe('acc2')
    expect(initAdapterForMock).toHaveBeenCalledTimes(1)
  })
})
