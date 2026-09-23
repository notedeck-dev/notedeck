// 「notecore は Tauri に依存しない」を機械検査に落とす (#1106 段階 0a / 0b)。
//
// crates/notecore は「デバイスが 1 台も繋がっていなくても意味を持つ処理」の置き場で、
// アプリ (src-tauri) に埋め込む構成と notecored で常駐させる構成の両方で使う。
// Cargo の依存方向 (notecore は notedeck を知らない) はコンパイラが守るが、
// 「tauri 系クレートを notecore の依存に足す」「`#[tauri::command]` を置く」は
// コンパイルが通ってしまうので、ここで落とす。
//
// 手元側 (WebView / OS 統合) が要る処理は trait (`FrontendBridge` / `AiChatSink` 等)
// で受け取る。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const CRATE = resolve(ROOT, 'crates/notecore')
const SRC = resolve(CRATE, 'src')

function rustFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...rustFiles(p))
    else if (entry.name.endsWith('.rs')) out.push(p)
  }
  return out.sort()
}

const files = rustFiles(SRC)

describe('notecore (crates/notecore) の境界 (#1106)', () => {
  it('ソースがある (検査対象を見失っていない)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('Cargo.toml に tauri 系の依存がない', () => {
    const manifest = readFileSync(resolve(CRATE, 'Cargo.toml'), 'utf-8')
    const offenders = manifest
      .split('\n')
      .filter((l) => /^\s*tauri/.test(l) || /^\s*notedeck\b/.test(l))
    expect(offenders).toEqual([])
  })

  it('commands/ (コマンド表の本体) に target 依存の #[cfg] を置かない', () => {
    // 表の行は全 target で生成されるので、本体が cfg で消えると Android / macOS /
    // Windows のビルドだけが落ちる (Linux の CI では見えない: v1.65.0 で踏んだ)。
    // 端末依存の処理は手元側 (src-tauri) に置く
    const violations: string[] = []
    for (const path of files) {
      if (!path.includes('/commands/')) continue
      const lines = readFileSync(path, 'utf-8').split('\n')
      lines.forEach((line, i) => {
        const m = line.match(/^\s*#\[cfg\((.*)\)\]/)
        if (!m) return
        if (/^(test|debug_assertions)$/.test(m[1].trim())) return
        violations.push(`${relative(ROOT, path)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(violations).toEqual([])
  })

  it('ソースで tauri を参照しない', () => {
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
})
