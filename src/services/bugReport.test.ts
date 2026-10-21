import { describe, expect, it } from 'vitest'
import { buildMisskeyReportText, OFFICIAL_MISSKEY_ACCOUNT } from './bugReport'

describe('buildMisskeyReportText (#1019)', () => {
  it('公式アカウントへのメンションで始まり、本文の余白を挟んで版と環境の 1 行で終わる', () => {
    const text = buildMisskeyReportText({
      version: '1.89.0',
      os: 'Linux',
      webView: 'WebKitGTK 2.46',
    })
    expect(text.startsWith(`@${OFFICIAL_MISSKEY_ACCOUNT} `)).toBe(true)
    expect(text.endsWith('NoteDeck v1.89.0 / Linux / WebKitGTK 2.46')).toBe(
      true,
    )
    // 書き出す場所 (空行) がある
    expect(text).toContain('\n\n\n')
  })
})
