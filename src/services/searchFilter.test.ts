import { describe, expect, it } from 'vitest'
import {
  clearPanelRows,
  clearRow,
  dateBounds,
  effectiveConditions,
  effectiveHostParam,
  externalQueryPatch,
  FACE_ROWS,
  hasActiveFilter,
  matchesPlainTerm,
  matchesTextConditions,
  migrateSearchColumns,
  parseAuthor,
  parseConditionWords,
  resolveScopeAccounts,
  rowHasValue,
  type SearchFilter,
  serverHostOptions,
  staleRows,
} from './searchFilter'

const accounts = [
  { id: 'a1', host: 'a.example' },
  { id: 'a2', host: 'A.example' },
  { id: 'b1', host: 'b.example' },
]

describe('resolveScopeAccounts', () => {
  it('未指定は全アカウント', () => {
    expect(resolveScopeAccounts(undefined, accounts)).toEqual([
      'a1',
      'a2',
      'b1',
    ])
    expect(resolveScopeAccounts('', accounts)).toEqual(['a1', 'a2', 'b1'])
  })

  it('server: はそのサーバーの全アカウント (大文字小文字を区別しない)', () => {
    expect(resolveScopeAccounts('server:a.example', accounts)).toEqual([
      'a1',
      'a2',
    ])
  })

  it('account: はそのアカウントだけ。消えたアカウントは空', () => {
    expect(resolveScopeAccounts('account:b1', accounts)).toEqual(['b1'])
    expect(resolveScopeAccounts('account:gone', accounts)).toEqual([])
  })
})

describe('dateBounds', () => {
  it('開始日は 0 時、終了日はその日の終わりまで含む', () => {
    const { since, until } = dateBounds({
      since: '2026-01-02',
      until: '2026-01-03',
    })
    expect(new Date(since as string).getTime()).toBe(
      new Date('2026-01-02T00:00:00').getTime(),
    )
    expect(new Date(until as string).getTime()).toBe(
      new Date('2026-01-03T23:59:59.999').getTime(),
    )
    expect(dateBounds({})).toEqual({ since: null, until: null })
  })
})

describe('面ごとの行と「効いている」判定', () => {
  it('面が宣言する行', () => {
    expect(FACE_ROWS.server).toEqual(['host', 'author', 'period', 'conditions'])
    expect(FACE_ROWS.client).toEqual([
      'scope',
      'author',
      'period',
      'attachments',
      'conditions',
    ])
  })

  it('並び順はパネルの行ではないので点灯しない。本文の条件は行なので点灯する', () => {
    expect(hasActiveFilter({ ascending: true })).toBe(false)
    expect(
      hasActiveFilter({
        conditions: [{ type: 'excludes', words: ['bot'] }],
      }),
    ).toBe(true)
    expect(hasActiveFilter({ conditions: [] })).toBe(false)
    expect(
      hasActiveFilter({
        conditions: [{ type: 'excludes', words: ['bot'] }],
        conditionsPaused: true,
      }),
    ).toBe(false)
    expect(hasActiveFilter({ author: '  ' })).toBe(false)
    expect(hasActiveFilter({ hasFiles: false })).toBe(true)
    expect(hasActiveFilter({ scope: 'server:a.example' })).toBe(true)
    expect(hasActiveFilter({ host: '.' })).toBe(true)
    expect(hasActiveFilter({ since: '2026-01-01' })).toBe(true)
  })

  it('rowHasValue は行単位', () => {
    const f: SearchFilter = { host: '.', since: '2026-01-01' }
    expect(rowHasValue(f, 'host')).toBe(true)
    expect(rowHasValue(f, 'period')).toBe(true)
    expect(rowHasValue(f, 'scope')).toBe(false)
    expect(rowHasValue(f, 'author')).toBe(false)
    expect(rowHasValue({ host: '' }, 'host')).toBe(false)
  })

  it('面に意味の無い行に値が残っていれば staleRows に出る', () => {
    expect(
      staleRows({ hasFiles: true, scope: 'account:a1', since: 'x' }, 'server'),
    ).toEqual(['scope', 'attachments'])
    expect(staleRows({ host: '.' }, 'client')).toEqual(['host'])
    expect(staleRows({ host: '.' }, 'server')).toEqual([])
  })
})

describe('クリア', () => {
  const full: SearchFilter = {
    scope: 'account:a1',
    host: '.',
    author: 'alice@a.example',
    authorIds: { a1: { id: 'u1', acct: 'alice@a.example' } },
    since: '2026-01-01',
    until: '2026-01-31',
    hasFiles: true,
    ascending: true,
    conditions: [{ type: 'excludes', words: ['bot'] }],
  }

  it('clearPanelRows はパネルの行 (本文の条件を含む) を消し、並び順は残す', () => {
    expect(clearPanelRows(full)).toEqual({ ascending: true })
  })

  it('clearRow(conditions) は一時停止の印も一緒に消す', () => {
    const cleared = clearRow({ ...full, conditionsPaused: true }, 'conditions')
    expect(cleared).not.toHaveProperty('conditions')
    expect(cleared).not.toHaveProperty('conditionsPaused')
  })

  it('clearRow は 1 行だけ消す (投稿者は解決済み ID も一緒に)', () => {
    expect(clearRow(full, 'author')).not.toHaveProperty('author')
    expect(clearRow(full, 'author')).not.toHaveProperty('authorIds')
    expect(clearRow(full, 'period')).toMatchObject({ host: '.' })
    expect(clearRow(full, 'period')).not.toHaveProperty('since')
    expect(clearRow(full, 'period')).not.toHaveProperty('until')
    expect(clearRow(full, 'attachments')).not.toHaveProperty('hasFiles')
    expect(clearRow(full, 'scope')).not.toHaveProperty('scope')
    expect(clearRow(full, 'host')).not.toHaveProperty('host')
  })
})

describe('本文の条件', () => {
  it('parseConditionWords はカンマ・読点・空白で割り、空を落とす', () => {
    expect(parseConditionWords(' cat, dog　bird、 ')).toEqual([
      'cat',
      'dog',
      'bird',
    ])
    expect(parseConditionWords('')).toEqual([])
  })

  const note = (text: string | null, cw: string | null = null) => ({
    text,
    cw,
  })

  it('いずれか / すべて / 除外。大文字小文字を区別せず CW も見る', () => {
    const any = [{ type: 'contains_any' as const, words: ['cat', 'dog'] }]
    expect(matchesTextConditions(note('I have a Dog'), any)).toBe(true)
    expect(matchesTextConditions(note('fish'), any)).toBe(false)
    expect(matchesTextConditions(note(null, 'cat'), any)).toBe(true)

    const all = [{ type: 'contains_all' as const, words: ['cat', 'dog'] }]
    expect(matchesTextConditions(note('cat and dog'), all)).toBe(true)
    expect(matchesTextConditions(note('cat only'), all)).toBe(false)

    const ex = [{ type: 'excludes' as const, words: ['bot'] }]
    expect(matchesTextConditions(note('I am a BOT'), ex)).toBe(false)
    expect(matchesTextConditions(note('human'), ex)).toBe(true)
  })

  it('本文の無いノートは、除外だけなら残り、含むなら落ちる', () => {
    expect(
      matchesTextConditions(note(null), [{ type: 'excludes', words: ['bot'] }]),
    ).toBe(true)
    expect(
      matchesTextConditions(note(null), [
        { type: 'contains_any', words: ['cat'] },
      ]),
    ).toBe(false)
  })

  it('語の無い条件と空の配列は全件通す', () => {
    expect(matchesTextConditions(note('x'), [])).toBe(true)
    expect(
      matchesTextConditions(note('x'), [{ type: 'contains_all', words: [] }]),
    ).toBe(true)
  })

  it('effectiveConditions は一時停止中なら空', () => {
    const conditions = [{ type: 'excludes' as const, words: ['bot'] }]
    expect(effectiveConditions({ conditions })).toEqual(conditions)
    expect(effectiveConditions({ conditions, conditionsPaused: true })).toEqual(
      [],
    )
    expect(effectiveConditions({})).toEqual([])
  })

  it('matchesPlainTerm: 単一語はリテラル含有、複数語はサーバーに委ねて素通し', () => {
    expect(matchesPlainTerm(note('Hello World'), 'world')).toBe(true)
    expect(matchesPlainTerm(note('Hello World'), 'xyz')).toBe(false)
    expect(matchesPlainTerm(note(null, 'xyz'), 'xyz')).toBe(true)
    expect(matchesPlainTerm(note('Hello'), 'foo bar')).toBe(true)
    expect(matchesPlainTerm(note('Hello'), '')).toBe(true)
  })
})

describe('外部からの検索語の差し替え', () => {
  it('期間と範囲を消し、本文の条件は消さずに止める。投稿者と並び順は残す', () => {
    const patched = externalQueryPatch({
      scope: 'account:a1',
      host: '.',
      since: '2026-01-01',
      until: '2026-01-02',
      author: 'alice',
      authorIds: { a1: { id: 'u1', acct: 'alice@a.example' } },
      ascending: true,
      conditions: [{ type: 'excludes', words: ['bot'] }],
    })
    expect(patched).toEqual({
      author: 'alice',
      authorIds: { a1: { id: 'u1', acct: 'alice@a.example' } },
      ascending: true,
      conditions: [{ type: 'excludes', words: ['bot'] }],
      conditionsPaused: true,
    })
  })

  it('本文の条件が無ければ一時停止の印は付けない', () => {
    expect(externalQueryPatch({ since: '2026-01-01' })).toEqual({})
    expect(externalQueryPatch(undefined)).toEqual({})
  })
})

describe('サーバー検索の範囲', () => {
  it('検索範囲の設定と連合の有無で選択肢を出し分ける (本家 Web と同じ)', () => {
    expect(
      serverHostOptions({ noteSearchableScope: 'global', federation: 'all' }),
    ).toEqual(['all', 'local', 'host'])
    expect(
      serverHostOptions({ noteSearchableScope: 'local', federation: 'all' }),
    ).toEqual(['local'])
    expect(
      serverHostOptions({ noteSearchableScope: 'global', federation: 'none' }),
    ).toEqual(['local'])
  })

  it('設定を返さないサーバーと読めなかったサーバーはローカルだけ', () => {
    expect(serverHostOptions({})).toEqual(['local'])
    expect(serverHostOptions(null)).toEqual(['local'])
    expect(serverHostOptions(undefined)).toEqual(['local'])
  })

  it('effectiveHostParam: 空は渡さない、自サーバーはローカルに読み替える', () => {
    expect(effectiveHostParam(undefined, 'a.example')).toBeUndefined()
    expect(effectiveHostParam('', 'a.example')).toBeUndefined()
    expect(effectiveHostParam('.', 'a.example')).toBe('.')
    expect(effectiveHostParam('A.example', 'a.example')).toBe('.')
    expect(effectiveHostParam('b.example', 'a.example')).toBe('b.example')
  })
})

describe('parseAuthor', () => {
  it('先頭の @ と空白を落とし、host を分ける', () => {
    expect(parseAuthor(' @alice@A.example ')).toEqual({
      username: 'alice',
      host: 'a.example',
    })
    expect(parseAuthor('alice')).toEqual({ username: 'alice', host: null })
    expect(parseAuthor('')).toBeNull()
    expect(parseAuthor('@')).toBeNull()
  })
})

describe('migrateSearchColumns', () => {
  it('クライアント検索の clientSearchFilter を searchFilter に移す', () => {
    const { columns, migrated } = migrateSearchColumns([
      {
        id: 'c1',
        type: 'clientSearch',
        clientSearchFilter: {
          scope: 'server:a.example',
          author: 'alice',
          since: '2026-01-01',
          hasFiles: true,
          ascending: true,
        },
      },
    ])
    expect(migrated).toBe(1)
    expect(columns[0]).toEqual({
      id: 'c1',
      type: 'clientSearch',
      searchFilter: {
        scope: 'server:a.example',
        author: 'alice',
        since: '2026-01-01',
        hasFiles: true,
        ascending: true,
      },
    })
  })

  it('サーバー検索の userId は解決済み ID として投稿者に移す (表記は後で補う)', () => {
    const { columns, migrated } = migrateSearchColumns([
      { id: 's1', type: 'search', accountId: 'a1', userId: 'u1' },
    ])
    expect(migrated).toBe(1)
    expect(columns[0]).toEqual({
      id: 's1',
      type: 'search',
      accountId: 'a1',
      searchFilter: { authorIds: { a1: { id: 'u1', acct: '' } } },
    })
  })

  it('全アカウントのサーバー検索に残った userId はどのサーバーの ID か分からないので捨てる', () => {
    const { columns, migrated } = migrateSearchColumns([
      { id: 's2', type: 'search', accountId: null, userId: 'u1' },
    ])
    expect(migrated).toBe(1)
    expect(columns[0]).toEqual({ id: 's2', type: 'search', accountId: null })
  })

  it('移行済み・無関係なカラムは触らない (冪等)', () => {
    const input = [
      { id: 's3', type: 'search', searchFilter: { host: '.' } },
      { id: 't1', type: 'timeline', userId: 'keep' },
      { id: 'c2', type: 'clientSearch' },
    ]
    const { columns, migrated } = migrateSearchColumns(input)
    expect(migrated).toBe(0)
    expect(columns).toEqual(input)
    expect(columns[0]).toBe(input[0])
  })
})
