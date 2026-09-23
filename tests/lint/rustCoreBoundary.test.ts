// 「notecore 配下は Tauri に依存しない」を機械検査に落とす (#1106 段階 0a)。
//
// src-tauri/src/core/ は将来の notecore クレート (デバイスが 1 台も繋がっていなくても
// 意味を持つ処理: Misskey 通信 / DB / キャッシュ / 設定ファイル store / 認可解決 /
// 公開 API トークン / OGP 等) の置き場。段階 0a ではクレートを切らず、この検査で
// 境界だけ先に作る。段階 0b で core/ をそのまま crates/notecore に移す。
//
// 守ること:
//   - core/ の中で `tauri` を参照しない (型も、async_runtime も、`#[tauri::command]` も)
//   - core/ から `crate::` で参照してよいのは core 自身と `crate::error` だけ
//     (手元側のモジュールや commands/ に依存すると、クレートに切った瞬間に壊れる)
//
// 逆向き (手元側が core を使う) は自由。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const CORE = resolve(ROOT, 'src-tauri/src/core')

/** core/ から参照してよい `crate::` 直下のモジュール */
const ALLOWED_CRATE_ROOTS = new Set(['core', 'error'])

function rustFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...rustFiles(p))
    else if (entry.name.endsWith('.rs')) out.push(p)
  }
  return out.sort()
}

const files = rustFiles(CORE)

describe('notecore 配下 (src-tauri/src/core) の境界 (#1106 段階 0a)', () => {
  it('core/ にファイルがある (検査対象を見失っていない)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('tauri を参照しない', () => {
    const violations: string[] = []
    for (const path of files) {
      const lines = readFileSync(path, 'utf-8').split('\n')
      lines.forEach((line, i) => {
        // コメント (説明で Tauri に言及する) と文字列リテラル ("tauri://localhost"
        // のような CORS origin) は依存ではない
        if (line.trim().startsWith('//')) return
        const code = line.replace(/"[^"]*"/g, '""')
        if (/\btauri(_specta|_plugin_[a-z_]+)?\b/.test(code)) {
          violations.push(`${relative(ROOT, path)}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('crate:: で参照するのは core 自身と error だけ', () => {
    const violations: string[] = []
    for (const path of files) {
      const lines = readFileSync(path, 'utf-8').split('\n')
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/\bcrate::([A-Za-z0-9_]+)/g)) {
          if (!ALLOWED_CRATE_ROOTS.has(m[1])) {
            violations.push(`${relative(ROOT, path)}:${i + 1}: crate::${m[1]}`)
          }
        }
      })
    }
    expect(violations).toEqual([])
  })
})
