import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateUserEmbedCode } from './embedCode'

describe('generateUserEmbedCode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('iframe と embed.js の script を改行区切りの 2 行で返す', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000000',
    )
    const lines = generateUserEmbedCode('misskey.example', 'user123').split(
      '\n',
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^<iframe .*><\/iframe>$/)
    expect(lines[0]).toContain(
      'src="https://misskey.example/embed/user-timeline/user123"',
    )
    expect(lines[0]).toContain(
      'data-misskey-embed-id="v1_00000000-0000-4000-8000-000000000000"',
    )
    expect(lines[0]).toContain('loading="lazy"')
    expect(lines[0]).toContain(
      'referrerpolicy="strict-origin-when-cross-origin"',
    )
    expect(lines[1]).toBe(
      '<script defer src="https://misskey.example/embed.js"></script>',
    )
  })

  it('呼ぶたびに iframe ID を発番し直す', () => {
    const a = generateUserEmbedCode('h.example', 'u')
    const b = generateUserEmbedCode('h.example', 'u')
    const idOf = (s: string) =>
      /data-misskey-embed-id="(v1_[^"]+)"/.exec(s)?.[1]
    expect(idOf(a)).toMatch(/^v1_[0-9a-f-]{36}$/)
    expect(idOf(a)).not.toBe(idOf(b))
  })

  it('userId は URL のパスとしてエスケープし、属性を壊さない', () => {
    const code = generateUserEmbedCode('h.example:8080', 'a"b')
    expect(code).toContain('https://h.example:8080/embed/user-timeline/a%22b"')
  })
})
