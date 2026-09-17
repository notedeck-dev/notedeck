// save() の書き込みと reload の読込の直列化 (#716)。書き込み完了前に
// 読み戻すと、メモリ上の権限変更・確認スキップ記憶が旧内容へ巻き戻る。
// read/write を制御可能にモックし、reload が pending write を待つことを検証。
import { describe, expect, it, vi } from 'vitest'

let readCalls = 0
let resolveWrite: (() => void) | undefined

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readPermissionsSettings: () => {
    readCalls++
    return Promise.resolve(
      JSON.stringify({ confirmSkips: { 'ai.chat': ['persisted.cap'] } }),
    )
  },
  readAiSettings: () => Promise.resolve(''),
  writeAiSettings: () => Promise.resolve(),
  writePermissionsSettings: () =>
    new Promise<void>((resolve) => {
      resolveWrite = resolve
    }),
}))

describe('save → reload 直列化 (#716)', () => {
  it('reload の読込は進行中の save の書き込み完了を待つ', async () => {
    const {
      usePermissionsConfig,
      reloadPermissionsConfig,
      whenPermissionsReady,
    } = await import('./store')

    // 初期化完了を待つ (初回 read 1 回)
    usePermissionsConfig()
    await whenPermissionsReady()
    expect(readCalls).toBe(1)

    // save() で書き込みを開始 (mock により pending)
    const { save } = usePermissionsConfig()
    save()

    // 書き込み完了前に reload を要求 — read はまだ走らない
    const reloaded = reloadPermissionsConfig()
    await Promise.resolve()
    await Promise.resolve()
    expect(readCalls).toBe(1)

    // 書き込みを完了させると reload の read が進む
    resolveWrite?.()
    await reloaded
    expect(readCalls).toBe(2)
  })
})
