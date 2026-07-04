/**
 * E2E: HTTP API 面 (#709) の外形テスト (#702)。
 * 実アプリを隔離プロファイルで起動し、外部アプリと同じ経路で駆動する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type E2eApp, launchApp } from './harness'

let app: E2eApp

beforeAll(async () => {
  app = await launchApp()
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
  it('カラムを追加 → 一覧反映 → 削除できる', async () => {
    const created = await app.post('/api/deck/columns', {
      type: 'notifications',
      name: 'e2e-column',
    })
    expect(created.status).toBe(200)
    const { id } = await created.json()
    expect(id).toBeTruthy()

    const listRes = await app.get('/api/deck/columns')
    expect(listRes.status).toBe(200)
    const columns = await listRes.json()
    expect(columns.some((c: { id: string }) => c.id === id)).toBe(true)

    const delRes = await app.del(`/api/deck/columns/${id}`)
    expect(delRes.status).toBe(204)

    const after = await (await app.get('/api/deck/columns')).json()
    expect(after.some((c: { id: string }) => c.id === id)).toBe(false)
  })
})
