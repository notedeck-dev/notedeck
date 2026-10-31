// 窓の役は Rust の名簿が決める (#1131)。JS に label `main` の比較を散らさない。
//
// 「メインの窓だけが持つ」仕事は `useRepresentative()` の `isRepresentative` で判定する。
// label を直接比べると、ミラーが代表になったときにその仕事が止まる (トレイ無し環境で
// メインを閉じた場合)。例外は label を読む 1 か所 (`currentWindowLabel`) だけ。

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

const sourceFiles = collect(SRC, ['.vue', '.ts']).filter(
  (f) => !f.endsWith('.test.ts') && !f.endsWith('bindings.ts'),
)

function offenders(pattern: RegExp): string[] {
  return sourceFiles
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => relative(resolve(SRC, '..'), f))
}

describe('窓の役は名簿で決める (#1131)', () => {
  it('label と main の比較が無い', () => {
    expect(offenders(/label\s*[!=]==?\s*'main'/)).toEqual([])
  })

  it('isMainDeckWindow は無い (useRepresentative に置き換わった)', () => {
    expect(offenders(/isMainDeckWindow/)).toEqual([])
  })

  // 窓を作るのは Rust (`sub_window_create`、#1131 段 4)。URL と label を JS で組む口を
  // 残さない。capability からも窓生成の権限を外してある
  it('new WebviewWindow は無い (窓は Rust が作る)', () => {
    expect(offenders(/new WebviewWindow\b/)).toEqual([])
  })

  it("'/pip' の比較は src/windows/kind.ts だけ (窓の素性の判定は 1 本)", () => {
    const hits = offenders(/(?:===|!==)\s*'\/pip'|startsWith\('\/pip'\)/)
    expect(hits).toEqual(['src/windows/kind.ts'])
  })
})
