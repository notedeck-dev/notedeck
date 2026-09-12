import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  buildNoteGroups,
  clusterByIdentity,
  defaultGroupContext,
  isGroupHidden,
  selectPrimary,
  truncateByGroups,
} from './noteGroup'
import { nestedVariantKey, noteIdentityOf, variantKeyOf } from './noteKey'
import { canonicalReactionKey } from './reactionKey'

/** Rust 側 identity_of の最小版 (テスト用) */
function makeNote(
  o: Partial<NormalizedNote> & {
    id: string
    _accountId: string
    _serverHost: string
  },
): NormalizedNote {
  const identity =
    o._identity ?? o.uri ?? `https://${o._serverHost}/notes/${o.id}`
  const identityHost = identity.replace(/^https?:\/\//, '').split('/')[0]
  return {
    _identity: identity,
    _isOrigin: identityHost === o._serverHost,
    _identityTrusted: true,
    contentHidden: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    text: 'body',
    cw: null,
    user: {
      id: 'author',
      username: 'x',
      host: null,
      name: null,
      avatarUrl: null,
    },
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    localOnly: false,
    ...o,
  }
}

const ORIGIN = 'https://origin.example/notes/n1'

/** 先頭 group (存在をアサートしてから返す) */
function firstGroup(groups: ReturnType<typeof buildNoteGroups>) {
  const g = groups[0]
  expect(g).toBeDefined()
  return g as NonNullable<typeof g>
}
const ctx = defaultGroupContext({
  accountOrder: ['acc-a', 'acc-b', 'acc-o'],
  hasToken: (id) => id !== 'guest',
  userIdOf: (id) => (id === 'acc-o' ? 'author' : `user-${id}`),
})

const originVariant = (extra: Partial<NormalizedNote> = {}) =>
  makeNote({
    id: 'n1',
    _accountId: 'acc-o',
    _serverHost: 'origin.example',
    ...extra,
  })
const remoteVariant = (
  accountId: string,
  host: string,
  extra: Partial<NormalizedNote> = {},
) =>
  makeNote({
    id: `local-${accountId}`,
    _accountId: accountId,
    _serverHost: host,
    uri: ORIGIN,
    user: {
      id: `remote-author-${host}`,
      username: 'x',
      host: 'origin.example',
      name: null,
      avatarUrl: null,
    },
    ...extra,
  })

describe('buildNoteGroups', () => {
  it('同一 identity の variant を 1 つの group に畳み、位置は最初の variant', () => {
    const a = remoteVariant('acc-a', 'a.example')
    const other = makeNote({
      id: 'x',
      _accountId: 'acc-a',
      _serverHost: 'a.example',
    })
    const b = remoteVariant('acc-b', 'b.example')
    const groups = buildNoteGroups([a, other, b], ctx)
    expect(groups.map((g) => g.rowKey)).toEqual([ORIGIN, other._identity])
    expect(groups[0]?.variants).toHaveLength(2)
  })

  it('整合検査を通らない variant は束ねず variant key の行として単独表示する', () => {
    const spoofed = remoteVariant('acc-b', 'b.example', {
      _identityTrusted: false,
    })
    const a = remoteVariant('acc-a', 'a.example')
    const groups = buildNoteGroups([a, spoofed], ctx)
    expect(groups).toHaveLength(2)
    expect(groups[1]?.rowKey).toBe(variantKeyOf(spoofed))
  })

  it('同一アカウントの 2 行目 (ap/show 経由) は辞書順で小さい id だけを残す', () => {
    const first = makeNote({
      id: 'r1',
      _accountId: 'acc-b',
      _serverHost: 'b.example',
      uri: ORIGIN,
    })
    const second = makeNote({
      id: 'r2',
      _accountId: 'acc-b',
      _serverHost: 'b.example',
      uri: ORIGIN,
    })
    const groups = buildNoteGroups([second, first], ctx)
    expect(groups[0]?.variants).toEqual([first])
  })

  it('reactedBy は全 variant の myReaction を正規キーで和集合にする', () => {
    const a = remoteVariant('acc-a', 'a.example', {
      myReaction: ':blob@origin.example:',
    })
    const o = originVariant({ myReaction: ':blob:' })
    const groups = buildNoteGroups([a, o], ctx)
    const key = canonicalReactionKey(':blob:', 'origin.example')
    expect(groups[0]?.reactedBy.get(key)).toEqual(['acc-o', 'acc-a'])
  })
})

describe('selectPrimary (設計 §5.2 のシナリオ)', () => {
  it('(a) 全 public、origin あり、自分のノート → 投稿者本人の variant (= origin)', () => {
    const o = originVariant()
    const a = remoteVariant('acc-a', 'a.example', { renoteCount: 99 })
    expect(selectPrimary([a, o], ctx)).toBe(o)
  })

  it('(b) followers 限定、A は本文あり、origin は非フォロワーで contentHidden → A', () => {
    const o = originVariant({
      visibility: 'followers',
      contentHidden: true,
      text: null,
    })
    const a = remoteVariant('acc-a', 'a.example', { visibility: 'followers' })
    expect(selectPrimary([o, a], ctx)).toBe(a)
  })

  it('(c) 投稿者が過去の public を followers に書き換え: origin=followers/hidden、B=public 本文あり → origin (本文は隠れる)', () => {
    const o = originVariant({
      visibility: 'followers',
      contentHidden: true,
      text: null,
    })
    const b = remoteVariant('acc-b', 'b.example', { visibility: 'public' })
    expect(selectPrimary([b, o], ctx)).toBe(o)
  })

  it('(e) ゲスト variant + トークン variant → トークン', () => {
    const guest = makeNote({
      id: 'g',
      _accountId: 'guest',
      _serverHost: 'origin.example',
    })
    const a = remoteVariant('acc-a', 'a.example')
    expect(selectPrimary([guest, a], ctx)).toBe(a)
  })

  it('(f) 同一サーバー 2 アカウント、どちらも非投稿者 → アカウント一覧の並び順', () => {
    const b = makeNote({
      id: 'n1',
      _accountId: 'acc-b',
      _serverHost: 'origin.example',
    })
    const a = makeNote({
      id: 'n1',
      _accountId: 'acc-a',
      _serverHost: 'origin.example',
    })
    expect(selectPrimary([b, a], ctx)).toBe(a)
  })

  it('public 階級では contentHidden を見ない (投稿者の隠す設定を尊重して origin を出す)', () => {
    const o = originVariant({ contentHidden: true, text: null })
    const b = remoteVariant('acc-b', 'b.example')
    expect(selectPrimary([b, o], ctx)).toBe(o)
  })

  it('取得順・反応数には依存しない', () => {
    const o = originVariant()
    const a = remoteVariant('acc-a', 'a.example', { reactions: { '👍': 50 } })
    expect(selectPrimary([a, o], ctx)).toBe(o)
    expect(selectPrimary([o, a], ctx)).toBe(o)
  })

  it('埋め込みが非 origin 由来の削除で隠された variant はランクが下がる', () => {
    const inner = makeNote({
      id: 'inner',
      _accountId: 'acc-o',
      _serverHost: 'origin.example',
    })
    const o = originVariant({ renoteId: 'inner', renote: inner, text: null })
    const innerB = makeNote({
      id: 'innerB',
      _accountId: 'acc-b',
      _serverHost: 'b.example',
      uri: 'https://origin.example/notes/inner',
    })
    const b = remoteVariant('acc-b', 'b.example', {
      renoteId: 'innerB',
      renote: innerB,
      text: null,
    })
    const deletedInO = defaultGroupContext({
      ...ctx,
      isDeleted: (key) => key === nestedVariantKey(o, 'inner'),
    })
    // origin の入れ子が削除されても (origin 由来) ランク下げの対象ではなく group 側で隠れる
    expect(selectPrimary([b, o], deletedInO)).toBe(o)
    const deletedInB = defaultGroupContext({
      ...ctx,
      isDeleted: (key) => key === nestedVariantKey(b, 'innerB'),
      userIdOf: () => undefined,
    })
    // 非 origin の入れ子削除 → b が下がる (origin より前に来ない)
    expect(selectPrimary([b, o], deletedInB)).toBe(o)
    const onlyB = selectPrimary(
      [
        b,
        remoteVariant('acc-a', 'a.example', {
          renoteId: 'innerA',
          renote: makeNote({
            id: 'innerA',
            _accountId: 'acc-a',
            _serverHost: 'a.example',
            uri: 'https://origin.example/notes/inner',
          }),
          text: null,
        }),
      ],
      deletedInB,
    )
    expect(onlyB._accountId).toBe('acc-a')
  })
})

describe('isGroupHidden (設計 §5.5)', () => {
  it('ユーザーの意思 (ミュート) はどれかの variant で隠れれば group を隠す', () => {
    const groups = buildNoteGroups(
      [remoteVariant('acc-a', 'a.example'), originVariant()],
      ctx,
    )
    const muted = defaultGroupContext({
      ...ctx,
      isUserHidden: (n) => n._accountId === 'acc-a',
    })
    expect(isGroupHidden(firstGroup(groups), muted)).toBe(true)
  })

  it('凍結は origin の variant に立ったときだけ group を隠し、非 origin なら候補から外すだけ', () => {
    const a = remoteVariant('acc-a', 'a.example')
    const o = originVariant()
    const groups = buildNoteGroups([a, o], ctx)
    const suspendedOnA = defaultGroupContext({
      ...ctx,
      isSuspended: (n) => n._accountId === 'acc-a',
    })
    expect(isGroupHidden(firstGroup(groups), suspendedOnA)).toBe(false)
    expect(selectPrimary([a, o], suspendedOnA)).toBe(o)
    const suspendedOnO = defaultGroupContext({
      ...ctx,
      isSuspended: (n) => n._accountId === 'acc-o',
    })
    expect(isGroupHidden(firstGroup(groups), suspendedOnO)).toBe(true)
  })

  it('origin で削除された identity の group は隠れる', () => {
    const groups = buildNoteGroups([remoteVariant('acc-a', 'a.example')], ctx)
    const deleted = defaultGroupContext({
      ...ctx,
      isDeletedAtOrigin: (id) =>
        id === noteIdentityOf(firstGroup(groups).primary),
    })
    expect(isGroupHidden(firstGroup(groups), deleted)).toBe(true)
  })
})

describe('clusterByIdentity / truncateByGroups', () => {
  it('離れて並んだ同 identity を最初の出現の直後に寄せる', () => {
    const a = remoteVariant('acc-a', 'a.example')
    const x = makeNote({
      id: 'x',
      _accountId: 'acc-a',
      _serverHost: 'a.example',
    })
    const b = remoteVariant('acc-b', 'b.example')
    expect(clusterByIdentity([a, x, b])).toEqual([a, b, x])
  })

  it('上限は group 数で数える', () => {
    const a = remoteVariant('acc-a', 'a.example')
    const b = remoteVariant('acc-b', 'b.example')
    const x = makeNote({
      id: 'x',
      _accountId: 'acc-a',
      _serverHost: 'a.example',
    })
    const y = makeNote({
      id: 'y',
      _accountId: 'acc-a',
      _serverHost: 'a.example',
    })
    expect(truncateByGroups([a, b, x, y], 2)).toEqual([a, b, x])
  })
})
