// 「設定ディレクトリの場所を知るコードは `app_dir.rs` と migrations 以外に無い」を
// 機械検査に落とす (#1333 §1)。
//
// `app_dir.join("notedeck")` や `SETTINGS_DIR` の参照がクレートごとに散ると、配置を
// 変えるとき (#1334) に取りこぼす。配置は notecore `app_dir.rs` の `Layout` だけが
// 知り、他のコードは `Core::layout()` か `Layout::from_root()` から取る。
//
// 例外は 2 つだけ:
//   - `crates/notecore/src/app_dir.rs` (正本) と `*/migrations.rs` (旧配置から新配置へ
//     動かす側なので、旧名を知っていてよい)
//   - 設定ディレクトリではない `notedeck` (例: `~/Downloads/notedeck/`)。その行に
//     `// nd-layout-ignore: <理由>` を置く (直前の行でも可)

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC_ROOTS = ['crates/notecore', 'crates/notemaid', 'src-tauri']

const ALLOWED = new Set(['crates/notecore/src/app_dir.rs'])
const IGNORE_MARKER = /\/\/ nd-layout-ignore: \S/

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\.join\("notedeck"\)/,
    why: '設定ディレクトリの導出は Layout に任せる',
  },
  {
    pattern: /\bSETTINGS_DIR\b/,
    why: '設定ディレクトリ名の定数は app_dir.rs だけが持つ',
  },
  {
    pattern: /\bsettings_base_dir\b/,
    why: '`Core::layout()` を使う (#1333 §1 で削除)',
  },
]

function rustFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'target' || entry.name === 'gen') continue
      out.push(...rustFiles(p))
    } else if (entry.name.endsWith('.rs')) out.push(p)
  }
  return out.sort()
}

describe('設定ディレクトリの場所を知るのは app_dir.rs だけ (#1333)', () => {
  const files = SRC_ROOTS.flatMap((r) => rustFiles(resolve(ROOT, r)))

  it('ソースがある (検査対象を見失っていない)', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('app_dir.rs と migrations 以外に設定ディレクトリの導出が無い', () => {
    const violations: string[] = []
    for (const path of files) {
      const rel = relative(ROOT, path)
      if (ALLOWED.has(rel) || /(^|\/)migrations\.rs$/.test(rel)) continue
      const lines = readFileSync(path, 'utf-8').split('\n')
      lines.forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return
        for (const { pattern, why } of FORBIDDEN) {
          if (!pattern.test(line)) continue
          if (
            IGNORE_MARKER.test(line) ||
            (i > 0 && IGNORE_MARKER.test(lines[i - 1]))
          )
            continue
          violations.push(`${rel}:${i + 1}: ${line.trim()}  — ${why}`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('正本の app_dir.rs が Layout を持つ', () => {
    const src = readFileSync(
      resolve(ROOT, 'crates/notecore/src/app_dir.rs'),
      'utf-8',
    )
    expect(src).toMatch(/pub struct Layout\b/)
    expect(src).toMatch(/pub fn from_root\(/)
  })
})
