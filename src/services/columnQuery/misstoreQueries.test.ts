import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { createReferenceFilter } from '@/services/columnQuery/referenceEvaluator'

/**
 * misstore の配布クエリを実コンパイラと参照評価器に通す回帰テスト (#1254)。
 *
 * 配布物は golden/misstore.json にスナップショットしてネットワークに依存しない。
 * 取り直しは misstore の checkout を隣に置いて `pnpm gen:golden-misstore`
 * (場所が違えば MISSTORE_DIR で指定)。
 */

const UPDATE = process.env.UPDATE_GOLDEN_MISSTORE === '1'
const GOLDEN_PATH = join(__dirname, 'golden/misstore.json')

interface StoreQuery {
  id: string
  /** misstore の tags に `sequential` がある = 🐢 逐次適用として配布している */
  sequential: boolean
  source: string
}

/** 配布クエリが参照するフィールドを一通り踏む代表ノート群 */
const NOTES: { name: string; note: unknown }[] = [
  {
    name: 'plain',
    note: {
      id: 'n1',
      text: 'こんにちは #misskey',
      cw: null,
      visibility: 'public',
      localOnly: false,
      user: {
        username: 'alice',
        host: null,
        name: 'Alice',
        isBot: false,
        isCat: false,
      },
      files: [],
      tags: ['misskey'],
      reactions: { '👍': 3 },
      myReaction: null,
      repliesCount: 0,
      renoteCount: 0,
      replyId: null,
      renoteId: null,
      reply: null,
      renote: null,
      channelId: null,
      poll: null,
    },
  },
  {
    name: 'pure-renote',
    note: {
      id: 'n2',
      text: null,
      cw: null,
      visibility: 'home',
      localOnly: false,
      user: {
        username: 'bob',
        host: 'remote.example',
        name: null,
        isBot: true,
        isCat: true,
      },
      files: [],
      reactions: {},
      myReaction: '❤',
      repliesCount: 0,
      renoteCount: 0,
      replyId: null,
      renoteId: 'n9',
      reply: null,
      renote: {
        id: 'n9',
        text: '動画です',
        user: { username: 'carol', host: null },
        files: [{ type: 'video/mp4' }],
      },
      channelId: null,
      poll: null,
    },
  },
  {
    name: 'reply-with-cw-and-files',
    note: {
      id: 'n3',
      text: '@dave ネタバレ',
      cw: 'Spoiler',
      visibility: 'specified',
      localOnly: true,
      user: {
        username: 'eve',
        host: null,
        name: 'Eve',
        isBot: false,
        isCat: false,
      },
      files: [{ type: 'image/png' }, { type: null }],
      reactions: {},
      myReaction: null,
      repliesCount: 5,
      renoteCount: 2,
      replyId: 'n8',
      renoteId: null,
      reply: {
        id: 'n8',
        text: '元',
        user: { username: 'dave', host: 'other.example' },
      },
      renote: null,
      channelId: 'ch1',
      poll: { choices: [] },
      modeFlags: { isNoteInYamiMode: true },
    },
  },
  {
    name: 'minimal',
    note: { id: 'n4', text: null, user: { username: 'frank' } },
  },
]

function readStore(dir: string): StoreQuery[] {
  const index = JSON.parse(
    readFileSync(join(dir, 'public/registry/queries.json'), 'utf8'),
  ) as { queries: { id: string; tags?: string[] }[] }
  return index.queries
    .map((q) => ({
      id: q.id,
      sequential: q.tags?.includes('sequential') ?? false,
      source: readFileSync(
        join(dir, 'public/registry/queries', q.id, 'query.is'),
        'utf8',
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

if (UPDATE) {
  const dir =
    process.env.MISSTORE_DIR ?? join(__dirname, '../../../../misstore')
  if (!existsSync(dir)) throw new Error(`misstore が見つからない: ${dir}`)
  writeFileSync(
    GOLDEN_PATH,
    `${JSON.stringify({ queries: readStore(dir) }, null, 2)}\n`,
  )
}

describe('misstore の配布クエリ', () => {
  const { queries } = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as {
    queries: StoreQuery[]
  }

  it('スナップショットが空でない', () => {
    expect(queries.length).toBeGreaterThan(0)
  })

  it.each(
    queries.map((q) => [q.id, q] as const),
  )('%s: ⚡/🐢 の判定が配布時の tags と一致する', (_id, q) => {
    const compiled = compileColumnQuery(q.source)
    if (q.sequential) {
      expect(compiled.ok, '🐢 として配布しているのに ⚡ で通った').toBe(false)
      if (compiled.ok) return
      expect(compiled.degradable, JSON.stringify(compiled.diagnostics)).toBe(
        true,
      )
    } else {
      expect(
        compiled.ok,
        compiled.ok ? '' : JSON.stringify(compiled.diagnostics),
      ).toBe(true)
      if (!compiled.ok) return
      expect(compiled.warnings).toEqual([])
    }
  })

  it.each(
    queries.map((q) => [q.id, q] as const),
  )('%s: 代表ノートで per-note エラーにならない', (_id, q) => {
    const filter = createReferenceFilter(q.source)
    try {
      for (const { name, note } of NOTES) {
        expect(filter.evaluate(note), name).not.toBe('error')
      }
    } finally {
      filter.dispose()
    }
  })
})
