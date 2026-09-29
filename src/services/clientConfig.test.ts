import { describe, expect, it } from 'vitest'
import {
  parseClientConfig,
  serializeClientConfig,
} from '@/services/clientConfig'

describe('client.json5 の codec (#1106)', () => {
  it('無い / 壊れた / 未知の値は auto に落ちる', () => {
    expect(parseClientConfig('')).toEqual({ backend: 'auto' })
    expect(parseClientConfig('{{{')).toEqual({ backend: 'auto' })
    expect(parseClientConfig("{ backend: 'nope' }")).toEqual({
      backend: 'auto',
    })
    expect(parseClientConfig('{}')).toEqual({ backend: 'auto' })
  })

  it('3 値を往復し、Rust 側と同じ書式で書く', () => {
    for (const backend of ['auto', 'embedded', 'resident'] as const) {
      const text = serializeClientConfig({ backend })
      expect(text).toContain(`backend: '${backend}',`)
      expect(parseClientConfig(text)).toEqual({ backend })
    }
    expect(serializeClientConfig({ backend: 'resident' })).toBe(
      "// この端末の AI (notemaid) の動かし方 (#1106)。auto = 常駐が居れば繋ぎ、無ければ子プロセス / embedded = 常に in-process / resident = 常駐にだけ繋ぐ\n{\n  backend: 'resident',\n}\n",
    )
  })
})
