/**
 * E2E: モック Misskey サーバーへの接続 (#702)。
 * seed したアカウントで実アプリがモックへ HTTP/WS 接続することを検証する。
 * ストリーミングの切断/再接続の回帰はここを土台に追加する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type E2eApp, isAttachMode, launchApp, waitFor } from './harness'
import { type MockMisskey, makeNote, startMockMisskey } from './mockMisskey'

const ACCOUNT_ID = 'e2e-account-00000000-0000-0000-0000-000000000001'

let mock: MockMisskey
let app: E2eApp

beforeAll(async () => {
  // attach モード (Android 実機) ではモック/プロファイル seed を制御できない
  if (isAttachMode) return
  mock = await startMockMisskey()
  app = await launchApp({
    env: {
      NOTECLI_INSECURE_HOSTS: mock.host,
      NOTEDECK_E2E_ALLOW_HOSTS: mock.host,
    },
    seedAccount: {
      id: ACCOUNT_ID,
      host: mock.host,
      token: mock.account.token,
      userId: mock.account.userId,
      username: mock.account.username,
    },
  })
})

afterAll(async () => {
  await app?.stop()
  await mock?.close()
})

/** note をモックから配信し、SSE (/api/events) まで届くかを返す */
async function deliveredToSse(noteText: string): Promise<boolean> {
  // SSE を購読してから push する (取りこぼし防止)
  const controller = new AbortController()
  // 途中で失敗しても SSE を開いたままにしない
  try {
    const res = await fetch(`${app.base}/api/events?type=note`, {
      headers: { Authorization: `Bearer ${app.token}` },
      signal: controller.signal,
    })
    expect(res.ok).toBe(true)
    const body = res.body
    if (!body) throw new Error('SSE body missing')
    const reader = body.getReader()
    const decoder = new TextDecoder()

    // 再接続直後は購読が一瞬空になる (WS churn) ため、配信できるまで
    // 同じ note を push し続ける (重複配信は同一 id なので無害)
    const note = makeNote(mock.account, mock.host, noteText)
    await waitFor(
      async () => mock.pushNote('homeTimeline', note) > 0,
      'note delivery to a live subscription',
      30_000,
      500,
    )

    const deadline = Date.now() + 30_000
    let buffer = ''
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SSE read timeout')), remaining),
        ),
      ])
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.includes(noteText)) return true
    }
    return false
  } finally {
    controller.abort()
  }
}

describe.skipIf(isAttachMode)('mock Misskey 接続', () => {
  it('seed したアカウントが accounts に載る (token は露出しない)', async () => {
    const res = await app.get('/api/accounts')
    expect(res.status).toBe(200)
    const accounts = await res.json()
    const acc = accounts.find((a: { id: string }) => a.id === ACCOUNT_ID)
    expect(acc).toBeDefined()
    expect(acc.host).toBe(mock.host)
    expect(acc.username).toBe(mock.account.username)
    expect(JSON.stringify(acc)).not.toContain(mock.account.token)
  })

  it('タイムラインカラムを追加すると WS 接続と homeTimeline 購読が確立する', async () => {
    const created = await app.post('/api/capabilities/column.add/execute', {
      type: 'timeline',
      tl: 'home',
      accountId: ACCOUNT_ID,
      name: 'e2e-home',
    })
    expect(created.status).toBe(200)
    expect((await created.json()).ok).toBe(true)

    await waitFor(
      async () => mock.wsConnectionCount() > 0,
      'WS connection to mock server',
      30_000,
      500,
    )
    await waitFor(
      async () => mock.subscribedChannels().includes('homeTimeline'),
      'homeTimeline subscription',
      30_000,
      500,
    )
  })

  it('/api/health の streams にアカウントの接続状態が connected で載る', async () => {
    await waitFor(
      async () => {
        const health = await (await app.get('/api/health')).json()
        const stream = (
          health.streams as Array<{ accountId: string; state: string }>
        )?.find((s) => s.accountId === ACCOUNT_ID)
        return stream?.state === 'connected'
      },
      'stream state connected in /api/health',
      30_000,
      1000,
    )
  })
})

describe.skipIf(isAttachMode)('ストリーミング切断/再接続 (#506 回帰)', () => {
  it('無通告切断後に自動再接続し、購読を replay する', async () => {
    expect(mock.wsConnectionCount()).toBeGreaterThan(0)
    mock.dropConnections()

    await waitFor(
      async () => mock.wsConnectionCount() > 0,
      'auto reconnect after abrupt drop',
      60_000,
      500,
    )
    await waitFor(
      async () => mock.subscribedChannels().includes('homeTimeline'),
      'homeTimeline subscription replay',
      60_000,
      500,
    )
  })

  it('再接続後に配信した note が SSE (/api/events) まで届く', async () => {
    const noteText = `e2e-note-${process.hrtime.bigint()}`
    expect(await deliveredToSse(noteText)).toBe(true)
  })
})

// 手動のオフラインモードは口座の購読をすべて消す。解除したら、開いたままの
// カラムに新着が戻ること (#1399。直す前は購読が張り直されなかった)
describe.skipIf(isAttachMode)('オフラインモードの解除 (#1399 回帰)', () => {
  it('入ると接続が切れ、解除すると開いていたカラムの購読が戻る', async () => {
    expect(mock.subscribedChannels()).toContain('homeTimeline')

    await app.runCommand('toggle-offline-mode')
    await waitFor(
      async () => mock.wsConnectionCount() === 0,
      'WS disconnect on entering offline mode',
      30_000,
      500,
    )

    await app.runCommand('toggle-offline-mode')
    await waitFor(
      async () => mock.subscribedChannels().includes('homeTimeline'),
      'homeTimeline subscription after leaving offline mode',
      30_000,
      500,
    )
  })

  it('解除後に配信した note が SSE (/api/events) まで届く', async () => {
    const noteText = `e2e-offline-note-${process.hrtime.bigint()}`
    expect(await deliveredToSse(noteText)).toBe(true)
  })
})
