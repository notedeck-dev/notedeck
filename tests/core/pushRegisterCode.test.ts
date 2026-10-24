import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Interpreter, Parser, utils, values } from '@syuilo/aiscript'
import { describe, expect, it } from 'vitest'

/**
 * push の購読登録のコード (#330、2026-10-24 の登録手順の作り直し) を、本家のフロントと
 * 同じ AiScript (1.2.1) で実際に動かす。コードは Rust (notecore::push_register) が組み、
 * golden に書き出している。利用者はこれを本家 Web の Scratchpad で実行するので、ここで
 * 文法や組み込み関数を間違えると利用者の手元で初めて壊れる。
 *
 * Scratchpad と同じく USER_ID / USER_USERNAME / Mk:api / Mk:dialog を差し込み、本家の
 * レジストリ (domain = アプリのトークンの id) と i/apps を手元の表で模す。
 * 判定表 (#330 issuecomment-6383525709):
 * - 登録に進むのは「生きている domain の登録待ちがちょうど 1 件、印が 0 件」だけ
 * - 0 件 + 取り消し済み → 古いコード (出力欄に 1 行)
 * - 0 件 + 済みだけ → 登録済み / 0 件 + 0 件 → 登録待ちなし / それ以外 → 止める
 */

const GOLDEN = resolve(
  import.meta.dirname,
  '../../crates/notecore/tests/fixtures/push_register_code.is',
)
const code = readFileSync(GOLDEN, 'utf8')
const NONCE = 'newnonceaaaaaaaa'
const SCOPE = 'notedeck/push'

type Entry = {
  domain: string | null
  scope: string
  key: string
  value: unknown
}

const pending = (endpoint: string) => ({
  v: 1,
  state: 'pending',
  endpoint,
  auth: 'AUTH',
  publickey: 'PUB',
})

interface World {
  user?: { id: string; username: string } | null
  apps: string[]
  registry: Entry[]
  registerResponse?: Record<string, unknown> | 'error'
}

async function run(world: World, source = code) {
  const calls: { endpoint: string; params: Record<string, unknown> }[] = []
  const dialogs: { title: string; text: string; type: string }[] = []
  const printed: string[] = []
  const errors: unknown[] = []
  const user =
    world.user === undefined ? { id: 'u1', username: 'alice' } : world.user
  const api = (name: string, p: Record<string, unknown>): unknown => {
    switch (name) {
      case 'i/registry/scopes-with-domain': {
        const byDomain = new Map<string | null, Set<string>>()
        for (const e of world.registry) {
          if (!byDomain.has(e.domain)) byDomain.set(e.domain, new Set())
          byDomain.get(e.domain)?.add(e.scope)
        }
        return [...byDomain].map(([domain, scopes]) => ({
          domain,
          scopes: [...scopes].map((s) => s.split('/')),
        }))
      }
      case 'i/apps':
        return world.apps.map((id) => ({ id, name: 'app' }))
      case 'i/registry/get-all': {
        const scope = (p.scope as string[]).join('/')
        return Object.fromEntries(
          world.registry
            .filter((e) => e.domain === (p.domain ?? null) && e.scope === scope)
            .map((e) => [e.key, e.value]),
        )
      }
      case 'i/registry/set': {
        const scope = (p.scope as string[]).join('/')
        const found = world.registry.find(
          (e) =>
            e.domain === (p.domain ?? null) &&
            e.scope === scope &&
            e.key === p.key,
        )
        if (found) found.value = p.value
        else
          world.registry.push({
            domain: (p.domain as string) ?? null,
            scope,
            key: p.key as string,
            value: p.value,
          })
        return null
      }
      case 'sw/register':
        if (world.registerResponse === 'error') return { error: true }
        return (
          world.registerResponse ?? {
            state: 'subscribed',
            key: 'SERVERKEY',
            userId: user?.id,
            endpoint: p.endpoint,
            sendReadMessage: true,
          }
        )
      case 'sw/update-registration':
        return {
          userId: user?.id,
          endpoint: p.endpoint,
          sendReadMessage: p.sendReadMessage,
        }
      case 'notifications/test-notification':
        return null
      default:
        throw new Error(`unexpected endpoint ${name}`)
    }
  }
  const interpreter = new Interpreter(
    {
      USER_ID: user ? values.STR(user.id) : values.NULL,
      USER_USERNAME: user ? values.STR(user.username) : values.NULL,
      'Mk:api': values.FN_NATIVE(([endpoint, params]) => {
        const name = utils.valToJs(endpoint) as string
        const body = utils.valToJs(params) as Record<string, unknown>
        calls.push({ endpoint: name, params: body })
        const result = api(name, body)
        if (result && typeof result === 'object' && 'error' in result) {
          return values.ERROR('request_failed', utils.jsToVal({ code: 'X' }))
        }
        return utils.jsToVal(result)
      }),
      'Mk:dialog': values.FN_NATIVE(([title, text, type]) => {
        dialogs.push({
          title: utils.valToJs(title) as string,
          text: utils.valToJs(text) as string,
          type: utils.valToJs(type) as string,
        })
        return values.NULL
      }),
    },
    {
      out: (v) => {
        printed.push(utils.valToString(v))
      },
      log: () => {
        // 使わない
      },
      err: (e) => {
        errors.push(e)
      },
    },
  )
  await interpreter.exec(Parser.parse(source))
  const registered = calls.filter((c) => c.endpoint === 'sw/register')
  return { calls, dialogs, printed, errors, registered, world }
}

const entry = (domain: string | null, key: string, value: unknown): Entry => ({
  domain,
  scope: SCOPE,
  key,
  value,
})

const stateOf = (world: World, domain: string | null, key: string) =>
  world.registry.find((e) => e.domain === domain && e.key === key)?.value as
    | Record<string, unknown>
    | undefined

describe('push の購読登録のコード (AiScript)', () => {
  it('正常: 登録待ちが 1 件なら登録し、済みの印で秘密を消し、テスト通知を送る', async () => {
    const r = await run({
      apps: ['tokA'],
      registry: [entry('tokA', NONCE, pending('https://ntfy.example/up1'))],
    })
    expect(r.errors).toEqual([])
    expect(r.registered).toEqual([
      {
        endpoint: 'sw/register',
        params: {
          endpoint: 'https://ntfy.example/up1',
          auth: 'AUTH',
          publickey: 'PUB',
          sendReadMessage: true,
        },
      },
    ])
    const stored = stateOf(r.world, 'tokA', NONCE)
    expect(stored?.state).toBe('done')
    expect(stored?.key).toBe('SERVERKEY')
    expect(stored).not.toHaveProperty('auth')
    expect(
      r.calls.some((c) => c.endpoint === 'notifications/test-notification'),
    ).toBe(true)
    // 同じホストのほかの口座へ続ける案内
    expect(r.dialogs).toHaveLength(1)
    expect(r.dialogs[0]?.type).toBe('success')
    expect(r.dialogs[0]?.text).toContain('@alice')
    expect(r.dialogs[0]?.text).toContain('@bob')
  })

  it('既存の購読が既読の合図なしで返ったら update-registration で有効にする', async () => {
    const r = await run({
      apps: ['tokA'],
      registry: [entry('tokA', NONCE, pending('https://ntfy.example/up1'))],
      registerResponse: {
        state: 'already-subscribed',
        key: 'SERVERKEY',
        userId: 'u1',
        endpoint: 'https://ntfy.example/up1',
        sendReadMessage: false,
      },
    })
    expect(r.calls.map((c) => c.endpoint)).toContain('sw/update-registration')
    expect(r.dialogs[0]?.type).toBe('success')
  })

  it('割り込み: 済みの印と第三者の登録待ちがあれば登録しない', async () => {
    const r = await run({
      apps: ['tokA', 'tokEvil'],
      registry: [
        entry('tokA', NONCE, { v: 1, state: 'done', key: 'K', userId: 'u1' }),
        entry('tokEvil', NONCE, pending('https://evil.example/x')),
      ],
    })
    expect(r.registered).toEqual([])
    expect(r.dialogs[0]?.type).toBe('error')
  })

  it('登録待ちが 2 件以上なら登録しない', async () => {
    const r = await run({
      apps: ['tokA', 'tokEvil'],
      registry: [
        entry('tokA', NONCE, pending('https://ntfy.example/up1')),
        entry('tokEvil', NONCE, pending('https://evil.example/x')),
      ],
    })
    expect(r.registered).toEqual([])
    expect(r.dialogs[0]?.type).toBe('error')
  })

  it('再ログイン: 失効したトークンの登録待ちを取り消し済みにし、新しい方を登録する', async () => {
    const r = await run({
      apps: ['tokB'],
      registry: [
        entry('tokA', 'oldnonceaaaaaaaa', pending('https://ntfy.example/old')),
        entry('tokB', NONCE, pending('https://ntfy.example/new')),
      ],
    })
    expect(r.registered.map((c) => c.params.endpoint)).toEqual([
      'https://ntfy.example/new',
    ])
    const old = stateOf(r.world, 'tokA', 'oldnonceaaaaaaaa')
    expect(old?.state).toBe('superseded')
    expect(old).not.toHaveProperty('auth')
  })

  it('古いコードが前に残っていても、出力欄に 1 行書くだけで後ろの新しいコードが登録する', async () => {
    const oldCode = code.replace(
      `let PASS = '${NONCE}'`,
      "let PASS = 'oldnonceaaaaaaaa'",
    )
    const r = await run(
      {
        apps: ['tokA'],
        registry: [
          entry('tokA', 'oldnonceaaaaaaaa', { v: 1, state: 'superseded' }),
          entry('tokA', NONCE, pending('https://ntfy.example/new')),
        ],
      },
      `${oldCode}\n${code}`,
    )
    expect(r.errors).toEqual([])
    expect(r.printed).toHaveLength(1)
    expect(r.registered).toHaveLength(1)
    expect(r.dialogs.map((d) => d.type)).toEqual(['success'])
  })

  it('済みの印だけなら「登録済み」、何も無ければ「登録待ちなし」を出す', async () => {
    const done = await run({
      apps: ['tokA'],
      registry: [
        entry('tokA', NONCE, { v: 1, state: 'done', key: 'K', userId: 'u1' }),
      ],
    })
    expect(done.registered).toEqual([])
    expect(done.dialogs[0]?.type).toBe('info')
    const zero = await run({ apps: ['tokA'], registry: [] })
    expect(zero.registered).toEqual([])
    expect(zero.dialogs[0]?.type).toBe('warning')
    expect(zero.dialogs[0]?.text).toContain('@alice')
  })

  it('対象外の口座や未ログインでは API を呼ばずに案内だけ出す', async () => {
    const other = await run({
      user: { id: 'u9', username: 'carol' },
      apps: ['tokA'],
      registry: [entry('tokA', NONCE, pending('https://ntfy.example/up1'))],
    })
    expect(other.calls).toEqual([])
    expect(other.dialogs[0]?.text).toContain('@carol')
    const anon = await run({ user: null, apps: [], registry: [] })
    expect(anon.calls).toEqual([])
    expect(anon.dialogs[0]?.type).toBe('warning')
  })

  it('登録が失敗したら済みの印を書かない', async () => {
    const r = await run({
      apps: ['tokA'],
      registry: [entry('tokA', NONCE, pending('https://ntfy.example/up1'))],
      registerResponse: 'error',
    })
    expect(stateOf(r.world, 'tokA', NONCE)?.state).toBe('pending')
    expect(r.dialogs[0]?.type).toBe('error')
  })

  it('domain が null (本家 Web 自身) の項目には触らない', async () => {
    const r = await run({
      apps: ['tokA'],
      registry: [
        entry(null, NONCE, pending('https://ntfy.example/web')),
        entry('tokA', NONCE, pending('https://ntfy.example/up1')),
      ],
    })
    expect(r.registered.map((c) => c.params.endpoint)).toEqual([
      'https://ntfy.example/up1',
    ])
  })
})
