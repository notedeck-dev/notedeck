import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Interpreter, Parser, utils, values } from '@syuilo/aiscript'
import { describe, expect, it } from 'vitest'

/**
 * push の購読登録のコード (#330 §5) を、本家のフロントと同じ AiScript (1.2.1) で実際に
 * 動かす。コードは Rust (notecore::push_register) が組み、golden に書き出している。
 * 利用者はこれを本家 Web の Scratchpad で実行するので、ここで文法や組み込み関数の
 * 名前を間違えると、利用者の手元で初めて壊れる。
 *
 * Scratchpad と同じく `USER_USERNAME` / `Mk:api` / `Mk:dialog` を差し込む。
 */

const GOLDEN = resolve(
  import.meta.dirname,
  '../../crates/notecore/tests/fixtures/push_register_code.is',
)
const code = readFileSync(GOLDEN, 'utf8')

const RESPONSE = {
  state: 'subscribed',
  key: 'BServerKey',
  userId: 'u1',
  endpoint: 'https://ntfy.example/upAbC?up=1',
  sendReadMessage: true,
}

async function runAs(username: string) {
  const calls: { endpoint: string; params: unknown }[] = []
  const dialogs: { title: string; text: string; type: string }[] = []
  const errors: unknown[] = []
  const interpreter = new Interpreter(
    {
      USER_USERNAME: values.STR(username),
      'Mk:api': values.FN_NATIVE(([endpoint, params]) => {
        calls.push({
          endpoint: utils.valToJs(endpoint) as string,
          params: utils.valToJs(params),
        })
        return utils.jsToVal(RESPONSE)
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
      out: () => {
        // Scratchpad の出力欄は見ない
      },
      log: () => {
        // 同上
      },
      err: (e) => {
        errors.push(e)
      },
    },
  )
  try {
    await interpreter.exec(Parser.parse(code))
  } catch (e) {
    errors.push(e)
  }
  return { calls, dialogs, errors }
}

describe('push の購読登録のコード (AiScript)', () => {
  it('同じ口座なら三つ組と既読の合図で sw/register を呼び、応答を JSON で見せる', async () => {
    const { calls, dialogs, errors } = await runAs('alice')
    expect(errors).toEqual([])
    expect(calls).toEqual([
      {
        endpoint: 'sw/register',
        params: {
          endpoint: 'https://ntfy.example/upAbC?up=1',
          auth: 'aGVsbG8',
          publickey: 'BPub_key-1',
          sendReadMessage: true,
        },
      },
    ])
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]?.type).toBe('success')
    const shown = dialogs[0]?.text ?? ''
    expect(shown.startsWith('```json\n')).toBe(true)
    expect(shown.endsWith('\n```')).toBe(true)
    expect(
      JSON.parse(shown.slice('```json\n'.length, -'\n```'.length)),
    ).toEqual(RESPONSE)
  })

  it('別の口座で本家 Web にログインしていたら、登録せずに止まる', async () => {
    const { calls, dialogs, errors } = await runAs('bob')
    expect(calls).toEqual([])
    expect(dialogs).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
  })
})
