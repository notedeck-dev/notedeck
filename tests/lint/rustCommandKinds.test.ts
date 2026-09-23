// 「Rust の IPC コマンドは全部、種別 (データ系 / 手元 / 認可境界 / 跨り) を
// 宣言している」を機械検査に落とす (#1106 段階 0a)。
//
// notecore (常駐可能なコア) と手元 (OS 統合) を分ける正本は「コマンド単位の
// 属性」で、モジュール配置は既定値を与えるだけ (#1106 仕様 §4.1)。段階 0a では
// クレートを切らないので、属性は `#[tauri::command]` の直前の行コメントで持つ:
//
//   // nd-command: data
//   #[tauri::command]
//
// 種別:
//   data   データ系。Misskey API / DB / キャッシュ / 設定ファイルなど、デバイスが
//          1 台も繋がっていなくても意味を持つ処理。段階 0b でコマンド表に載り、
//          リモート構成では notecored で実行される
//   local  OS 統合。ウィンドウ / トレイ / クリップボード / dialog / OS 通知の表示 /
//          端末の状態など、UI のある端末でしか意味を持たない処理。手元に残る
//   authz  認可境界を動かす操作。権限ファイル / 信頼設定 / 公開 API トークン /
//          Vault の secret / デバイス表に触れる。リモート構成では橋がネイティブ
//          ダイアログで確認してから通す
//   mixed  data と local が 1 関数に同居している。新しく作らない (既存 8 件は 2026-09-23 に分割済み)
//
// 「認可境界」は忘れると危ないので denylist で二重に検査する: 本体が権限ファイル /
// トークン store / Vault の secret 操作に触れているのに authz でなければ落とす。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const RUST_SRC = resolve(ROOT, 'src-tauri/src')

const KINDS = ['data', 'local', 'authz', 'mixed'] as const
type Kind = (typeof KINDS)[number]

const MARKER = /^\s*\/\/ nd-command: (\S+)\s*$/
const COMMAND_ATTR = /^\s*#\[tauri::command(\(.*\))?\]\s*$/
const FN_NAME = /^\s*pub(?:\(crate\))? (?:async )?fn ([A-Za-z0-9_]+)/

/**
 * 本体がこれらに触れるコマンドは `authz` でなければならない。
 * パターンは「コマンド本体 (次のコマンドまで) に現れる識別子」で見る。
 */
const AUTHZ_DENYLIST: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bApiTokenStore\b/,
    why: '公開 API の永続トークンの発行・失効・一覧 (#709)',
  },
  {
    pattern: /\bstore::(write_root_file|import_bundle)\(/,
    why: 'ルート設定ファイル (permissions.json5 を含む) の書き換え (#712)',
  },
  {
    pattern:
      /\bservice::(upsert_metadata|upsert_with_secret|set_secret|delete_secret|delete_connection|update_connection|migrate_ai_provider)\(/,
    why: 'Vault の secret 書込・接続の信頼設定の変更 (#564)',
  },
  {
    pattern:
      /\bauth_service::complete_and_save\(|\baccount_service::(logout|delete)\(/,
    why: 'Misskey アカウント資格情報の保存・失効',
  },
]

/** `#[tauri::command]` を文字列やマクロ内に持つだけで、実体のコマンドは持たないファイル */
const EXCLUDED_FILES = new Set([
  'src-tauri/src/ipc_index.rs',
  // コマンド表からラッパーを生成するマクロ。実体は表 (commandsInTable) で数える
  'src-tauri/src/commands/table.rs',
])

interface Command {
  file: string
  name: string
  line: number
  kind: Kind | null
  rawKind: string | null
  body: string
}

function rustFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...rustFiles(p))
    else if (entry.name.endsWith('.rs')) out.push(p)
  }
  return out.sort()
}

/** ファイル中の全コマンドを「マーカー / 名前 / 本体」つきで拾う */
function commandsIn(path: string): Command[] {
  const lines = readFileSync(path, 'utf-8').split('\n')
  const file = relative(ROOT, path)
  const attrLines = lines
    .map((l, i) => (COMMAND_ATTR.test(l) ? i : -1))
    .filter((i) => i >= 0)
  return attrLines.map((attrLine, idx) => {
    const prev = lines[attrLine - 1] ?? ''
    const m = prev.match(MARKER)
    const rawKind = m ? m[1] : null
    const kind =
      rawKind && (KINDS as readonly string[]).includes(rawKind)
        ? (rawKind as Kind)
        : null
    let name = '?'
    for (let i = attrLine + 1; i < Math.min(lines.length, attrLine + 6); i++) {
      const fm = lines[i].match(FN_NAME)
      if (fm) {
        name = fm[1]
        break
      }
    }
    const end = attrLines[idx + 1] ?? lines.length
    return {
      file,
      name,
      line: attrLine + 1,
      kind,
      rawKind,
      body: lines.slice(attrLine, end).join('\n'),
    }
  })
}

/**
 * notecore のコマンド表 (#1106)。表の行は種別を先頭に持つので、マーカーの代わりに
 * その種別を採る。本体は notecore にあり Tauri ラッパーは生成されるので、
 * denylist 検査の対象 (本体) はここには無い。
 */
const TABLE = resolve(ROOT, 'crates/notecore/src/commands/table.rs')
const TABLE_ROW =
  /^\s*(data|local|authz|mixed)\b(?:\s*\([^)]*\))?\s+([A-Za-z0-9_]+)\s*\(/

function commandsInTable(): Command[] {
  const lines = readFileSync(TABLE, 'utf-8').split('\n')
  const file = relative(ROOT, TABLE)
  const out: Command[] = []
  lines.forEach((line, i) => {
    const m = line.match(TABLE_ROW)
    if (!m) return
    out.push({
      file,
      name: m[2],
      line: i + 1,
      kind: m[1] as Kind,
      rawKind: m[1],
      body: '',
    })
  })
  return out
}

const commands = [
  ...rustFiles(RUST_SRC)
    .filter((p) => !EXCLUDED_FILES.has(relative(ROOT, p)))
    .flatMap(commandsIn),
  ...commandsInTable(),
]

describe('Rust IPC コマンドの種別宣言 (#1106 段階 0a)', () => {
  it('コマンドが 1 つ以上見つかる (検査対象を見失っていない)', () => {
    expect(commands.length).toBeGreaterThan(200)
    expect(commandsInTable().length).toBeGreaterThan(0)
  })

  it('コマンド名はマーカー付きと表で重複しない', () => {
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const c of commands) {
      const prev = seen.get(c.name)
      if (prev) dupes.push(`${c.name}: ${prev} と ${c.file}`)
      seen.set(c.name, c.file)
    }
    expect(dupes).toEqual([])
  })

  it('全コマンドが #[tauri::command] の直前に `// nd-command: <kind>` を持つ', () => {
    const missing = commands
      .filter((c) => c.kind === null)
      .map(
        (c) =>
          `${c.file}:${c.line} ${c.name}` +
          (c.rawKind ? ` (不正な種別 "${c.rawKind}")` : ' (マーカーなし)'),
      )
    expect(missing, `種別は ${KINDS.join(' / ')} のどれか`).toEqual([])
  })

  it('権限ファイル / トークン store / Vault secret に触れるコマンドは authz', () => {
    const violations: string[] = []
    for (const c of commands) {
      if (c.kind === 'authz') continue
      for (const rule of AUTHZ_DENYLIST) {
        if (rule.pattern.test(c.body)) {
          violations.push(`${c.file}:${c.line} ${c.name} — ${rule.why}`)
          break
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('denylist の各パターンは実在するコマンドに当たる (腐った denylist を検出)', () => {
    for (const rule of AUTHZ_DENYLIST) {
      const hits = commands.filter((c) => rule.pattern.test(c.body))
      expect(hits.length, `${rule.pattern} (${rule.why})`).toBeGreaterThan(0)
    }
  })
})
