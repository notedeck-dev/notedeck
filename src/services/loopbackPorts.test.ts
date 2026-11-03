import { describe, expect, it } from 'vitest'
import golden from '@/aiscript/golden/loopbackHeader.json'
import {
  isAlwaysDeniedLoopbackPort,
  loopbackPortOf,
  MAX_LOOPBACK_PORTS,
  normalizeLoopbackPorts,
} from './loopbackPorts'

describe('loopbackPorts (#1293)', () => {
  it('上限は golden と同じ', () => {
    expect(golden.maxPorts).toBe(MAX_LOOPBACK_PORTS)
  })

  it('自アプリ / ブラウザが繋がない / 危険なローカルサービスのポートは常に拒否', () => {
    for (const p of [19820, 19821, 5173, 25, 22, 2375, 2376, 9222, 9229]) {
      expect(isAlwaysDeniedLoopbackPort(p), String(p)).toBe(true)
    }
    for (const p of [8080, 3000, 11434, 1234]) {
      expect(isAlwaysDeniedLoopbackPort(p), String(p)).toBe(false)
    }
  })

  it('正規化は整数・範囲・重複・拒否ポート・上限を見る', () => {
    expect(normalizeLoopbackPorts([3000, 8080, 3000])).toEqual([3000, 8080])
    expect(
      normalizeLoopbackPorts(['8080', 80.5, 0, 65536, -1, true, null, 4000]),
    ).toEqual([4000])
    expect(normalizeLoopbackPorts(8080)).toEqual([])
    expect(
      normalizeLoopbackPorts([
        8001, 8002, 8003, 8004, 8005, 8006, 8007, 8008, 8009, 8010,
      ]),
    ).toHaveLength(MAX_LOOPBACK_PORTS)
  })

  it('loopback の 3 表記だけをポート付きで認める', () => {
    expect(loopbackPortOf('http://localhost:8080/x')).toBe(8080)
    expect(loopbackPortOf('http://LOCALHOST:8080/x')).toBe(8080)
    expect(loopbackPortOf('http://127.0.0.1:3000/')).toBe(3000)
    expect(loopbackPortOf('http://[::1]:3000/')).toBe(3000)
    expect(loopbackPortOf('http://localhost/')).toBe(80)
    expect(loopbackPortOf('https://127.0.0.1/')).toBe(443)
    for (const other of [
      'http://localhost./',
      'http://0.0.0.0:80/',
      'http://127.0.0.2:80/',
      'http://[::ffff:127.0.0.1]:80/',
      'http://127.0.0.1.nip.io:80/',
      'https://example.com/',
      'ftp://localhost:21/',
      'not a url',
      42,
    ]) {
      expect(loopbackPortOf(other), String(other)).toBeNull()
    }
  })
})
