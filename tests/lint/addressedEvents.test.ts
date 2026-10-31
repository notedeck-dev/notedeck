// 宛先付きイベント (#1131) は `listenAddressed` でだけ聴く。
//
// Rust は「1 窓だけが処理する」イベント (外部からの問い合わせ / deep link / 通知クリック /
// トレイの切替) を、宛先の label を `to` に持たせて全窓へ流す。受けた窓が自分宛てか
// 判定せずに `events.x.listen` で直接聴くと、全窓で実行される旧挙動が再発する
// (fail-open)。判定は `src/utils/addressedEvents.ts` の 1 か所に閉じる。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../../src')

function collect(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path, ext)
    return ext.some((e) => entry.name.endsWith(e)) ? [path] : []
  })
}

const ADDRESSED_EVENTS = [
  'queryRequest',
  'addressedDeepLink',
  'notificationClickAddressed',
  'trayToggle',
]

const sourceFiles = collect(SRC, ['.vue', '.ts']).filter(
  (f) => !f.endsWith('.test.ts') && !f.endsWith('bindings.ts'),
)

describe('宛先付きイベントは listenAddressed でだけ聴く (#1131)', () => {
  it('検査対象を取りこぼしていない', () => {
    expect(sourceFiles.length).toBeGreaterThan(100)
  })

  it('events.<宛先付き>.listen / .once の直接呼び出しが無い', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const text = readFileSync(file, 'utf8')
      for (const name of ADDRESSED_EVENTS) {
        const direct = new RegExp(
          `events\\.${name}\\s*(\\([^)]*\\))?\\s*\\.(listen|once)\\(`,
        )
        if (direct.test(text)) {
          offenders.push(
            `${relative(resolve(SRC, '..'), file)}: events.${name}`,
          )
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('宛先付きイベントの一覧が bindings と一致する (to を持つ event)', () => {
    const bindings = readFileSync(resolve(SRC, 'bindings.ts'), 'utf8')
    for (const name of ADDRESSED_EVENTS) {
      expect(bindings).toContain(`${name}: `)
    }
  })
})
