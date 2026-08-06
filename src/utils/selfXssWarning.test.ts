import { afterEach, describe, expect, it, vi } from 'vitest'
import { printSelfXssWarning } from './selfXssWarning'

describe('printSelfXssWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 文面と警告色は Misskey 本家 (packages/frontend/src/boot/common.ts +
  // locales/ja-JP.yml の _selfXssPrevention) の完全再現。ここが崩れると
  // 「本家と同じ警告」であることが伝わらなくなるので値ごと固定する
  it('本家と同じ文面・同じ配色で 5 行出す', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    printSelfXssWarning()

    expect(log.mock.calls).toEqual([
      [
        '%c警告',
        'color: #f00; background-color: #ff0; font-size: 36px; padding: 4px;',
      ],
      [
        '%c「この画面に何か貼り付けろ」はすべて詐欺です。',
        'color: #f00; font-weight: 900; font-family: "Hiragino Sans W9", "Hiragino Kaku Gothic ProN", sans-serif; font-size: 24px;',
      ],
      [
        '%cここに何かを貼り付けると、悪意のあるユーザーにアカウントを乗っ取られたり、個人情報を盗まれたりする可能性があります。',
        'font-size: 16px; font-weight: 700;',
      ],
      [
        '%c貼り付けようとしているものが何なのかを正確に理解していない場合は、%c今すぐ作業を中止してこのウィンドウを閉じてください。',
        'font-size: 16px;',
        'font-size: 20px; font-weight: 700; color: #f00;',
      ],
      [
        '詳しくはこちらをご確認ください。 https://misskey-hub.net/docs/for-users/resources/self-xss/',
      ],
    ])
  })
})
