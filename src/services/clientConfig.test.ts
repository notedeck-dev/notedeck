import { describe, expect, it } from 'vitest'
import {
  parseClientConfig,
  serializeClientConfig,
} from '@/services/clientConfig'

describe('client.json5 の codec (#1106 段階 3a)', () => {
  it('無い / 壊れた / 未知の値は embedded に落ちる', () => {
    expect(parseClientConfig('')).toEqual({ backend: 'embedded' })
    expect(parseClientConfig('{{{')).toEqual({ backend: 'embedded' })
    expect(parseClientConfig("{ backend: 'nope' }")).toEqual({
      backend: 'embedded',
    })
    expect(parseClientConfig('{}')).toEqual({ backend: 'embedded' })
  })

  it('3 値を往復し、Rust 側と同じ書式で書く', () => {
    for (const backend of [
      'embedded',
      'pending-resident',
      'resident',
    ] as const) {
      const text = serializeClientConfig({ backend })
      expect(text).toContain(`backend: '${backend}',`)
      expect(parseClientConfig(text)).toEqual({ backend })
    }
    expect(serializeClientConfig({ backend: 'resident' })).toBe(
      "// この端末の構成 (#1106)。embedded = アプリに埋め込んだ notecore、resident = 常駐の notecored に中継\n{\n  backend: 'resident',\n}\n",
    )
  })
})
