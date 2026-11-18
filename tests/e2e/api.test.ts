/**
 * E2E: HTTP API 面 (#709) の外形テスト (#702)。
 * 実アプリを隔離プロファイルで起動し、外部アプリと同じ経路で駆動する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type E2eApp, isAttachMode, launchApp } from './harness'

// 権限ウィンドウで発行する代わりに、発行済みの外部トークンを起動前に仕込む (#1292)。
// ハーネスの external principal が許すのは deck.write だけ
const DECK_BOT = {
  id: 'tok-deck',
  name: 'e2e deck bot',
  token: 'ndp_e2e_deck',
  scope: { preset: 'custom', custom: { 'deck.write': true } },
}
const EMPTY_BOT = {
  id: 'tok-empty',
  name: 'e2e empty bot',
  token: 'ndp_e2e_empty',
  scope: { preset: 'custom', custom: {} },
}
/** external が許していない権限を scope で名乗る */
const GREEDY_BOT = {
  id: 'tok-greedy',
  name: 'e2e greedy bot',
  token: 'ndp_e2e_greedy',
  scope: { preset: 'custom', custom: { 'notes.write': true } },
}

let app: E2eApp

beforeAll(async () => {
  app = await launchApp({ seedApiTokens: [DECK_BOT, EMPTY_BOT, GREEDY_BOT] })
})

afterAll(async () => {
  await app?.stop()
})

describe('health', () => {
  it('backend と frontend の両方が ready', async () => {
    const res = await app.get('/api/health')
    expect(res.status).toBe(200)
    const health = await res.json()
    expect(health.backendReady).toBe(true)
    expect(health.frontendReady).toBe(true)
    expect(health.doctor.checks.length).toBeGreaterThan(0)
  })
})

describe('auth', () => {
  it('トークンなしは 401', async () => {
    const res = await fetch(`${app.base}/api/health`)
    expect(res.status).toBe(401)
  })

  it('不正なトークンは 401', async () => {
    const res = await fetch(`${app.base}/api/health`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
  })
})

describe('capabilities', () => {
  it('一覧にシグネチャ付き capability が載る', async () => {
    const res = await app.get('/api/capabilities')
    expect(res.status).toBe(200)
    const caps = await res.json()
    expect(Array.isArray(caps)).toBe(true)
    expect(caps.length).toBeGreaterThan(100)
    const timeNow = caps.find((c: { id: string }) => c.id === 'time.now')
    expect(timeNow).toBeDefined()
    expect(timeNow.name).toBe('time_now')
    expect(timeNow.description).toBeTruthy()
  })

  it('権限不要 capability を実行できる', async () => {
    const res = await app.post('/api/capabilities/time.now/execute')
    expect(res.status).toBe(200)
    const result = await res.json()
    expect(result.ok).toBe(true)
    expect(typeof result.result).toBe('string')
  })

  it('write 系は default readonly で 403 permission_denied', async () => {
    const res = await app.post('/api/capabilities/memos.create/execute', {
      title: 'x',
      body: 'y',
    })
    expect(res.status).toBe(403)
    const result = await res.json()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('permission_denied')
  })

  it('未知の capability は 404 unknown_capability', async () => {
    const res = await app.post('/api/capabilities/no.such.cap/execute')
    expect(res.status).toBe(404)
    const result = await res.json()
    expect(result.code).toBe('unknown_capability')
  })
})

describe('deck', () => {
  // カラム追加/削除の専用ルートは #711 で削除済み — 外部からの操作は
  // capabilities/execute (= dispatcher の権限判定を通る唯一の経路) を使う
  it('カラムを追加 → 一覧反映 → 削除できる (capability 経由)', async () => {
    const created = await app.post('/api/capabilities/column.add/execute', {
      type: 'notifications',
      name: 'e2e-column',
    })
    expect(created.status).toBe(200)
    const { ok, result } = await created.json()
    expect(ok).toBe(true)
    const id = (result as { id: string }).id
    expect(id).toBeTruthy()

    const listRes = await app.get('/api/deck/columns')
    expect(listRes.status).toBe(200)
    const columns = await listRes.json()
    expect(columns.some((c: { id: string }) => c.id === id)).toBe(true)

    const delRes = await app.post('/api/capabilities/column.remove/execute', {
      id,
    })
    expect(delRes.status).toBe(200)
    expect((await delRes.json()).ok).toBe(true)

    const after = await (await app.get('/api/deck/columns')).json()
    expect(after.some((c: { id: string }) => c.id === id)).toBe(false)
  })
})

// 実効の権限 = external principal の権限 ∩ トークンの scope (#1292 / #1409)。
// 仕込みは起動前のファイル配置なので、起動済みのアプリに繋ぐ attach モードでは走らせない
describe.skipIf(isAttachMode)('token scope', () => {
  it('発行していないトークンは 401', async () => {
    const res = await app.as('ndp_e2e_unknown').get('/api/health')
    expect(res.status).toBe(401)
  })

  it('scope にある権限の操作は通る', async () => {
    const bot = app.as(DECK_BOT.token)
    const created = await bot.post('/api/capabilities/column.add/execute', {
      type: 'notifications',
      name: 'e2e-scope-column',
    })
    expect(created.status).toBe(200)
    const { result } = await created.json()
    const removed = await bot.post('/api/capabilities/column.remove/execute', {
      id: (result as { id: string }).id,
    })
    expect(removed.status).toBe(200)
  })

  it('scope に無い権限の操作は、external が許していても 403', async () => {
    const res = await app
      .as(EMPTY_BOT.token)
      .post('/api/capabilities/column.add/execute', {
        type: 'notifications',
        name: 'e2e-denied-column',
      })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('permission_denied')
  })

  it('権限の要らない操作は、scope が空でも通る', async () => {
    const res = await app
      .as(EMPTY_BOT.token)
      .post('/api/capabilities/time.now/execute')
    expect(res.status).toBe(200)
  })

  it('external が許していない権限は、scope にあっても 403 (scope は広げない)', async () => {
    const res = await app
      .as(GREEDY_BOT.token)
      .post('/api/capabilities/notes.create/execute', { text: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('permission_denied')
  })
})
