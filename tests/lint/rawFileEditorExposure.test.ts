// 「生ファイルを直接編集する面は開発者モードに従う」を機械検査に落とす (#1034)。
//
// 決定は DEVELOPMENT.md の "開発者モードと露出タグ" にある。隠すのは Raw データを
// 見る面と生ファイルを編集する面で、配布物は「カラムは一般 / 作成・編集は開発者」。
// ところがこの規則は窓ごとの宣言的 opt-in で実装されているため、新しい編集窓を
// 足したときに宣言を忘れても何も起きない — 実際にアピアランス / キーバインド /
// テーマ / 権限の 4 窓だけが宣言していて、同じ形の窓が 6 つ素通しになっていた。
//
// 検査の信号は `useWindowExternalFile`。これを呼ぶ窓は「ヘッダの OS 既定エディタで
// 開く」を持つ = 設定ファイルなり配布物のソースなりを直接いじる面なので、露出の
// 判定 (`isExposed`) を参照しているはず。参照しない窓は ALLOWED に理由を書く。
//
// ここが落ちたら、まず既存 4 窓と同じ opt-in (editorTabs を computed にして
// code タブを外し、useWindowExternalFile も判定に通す) を足せないか検討する。
// 「コンテンツ本体なので一般」と判断したときだけ ALLOWED に足す。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const COMPONENTS = join(ROOT, 'src/components')

/**
 * 判定を参照しない編集窓と、その理由。
 *
 * - registry : ウィンドウ種別そのものが developer タグを持つ (入口はレジストリで閉じる)
 * - content  : 編集対象がユーザーのコンテンツで、設定ファイルでも配布物のソースでもない
 */
const ALLOWED: Record<string, string> = {
  'src/components/window/CssEditorContent.vue':
    'content: custom.css は唯一の編集面。Misskey 文化圏ではコピペで使う一般ヘビーユーザーの面 (決定録 1)',
  'src/components/window/MemoEditorContent.vue':
    'content: メモの本文 (.md) は PKM としてのユーザーコンテンツ。設定ファイルではない',
  'src/components/window/SkillEditContent.vue':
    'registry: skill-edit が developer タグ',
  'src/components/window/SnippetsEditorContent.vue':
    'registry: snippetsEditor が developer タグ',
  'src/components/window/TasksEditorContent.vue':
    'registry: tasksEditor が developer タグ',
}

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...vueFiles(path))
    else if (entry.name.endsWith('.vue')) out.push(path)
  }
  return out
}

describe('生ファイルを編集する窓の露出宣言', () => {
  it('useWindowExternalFile を呼ぶ窓は露出判定を参照する', () => {
    const missing: string[] = []
    for (const file of vueFiles(COMPONENTS)) {
      const src = readFileSync(file, 'utf-8')
      if (!src.includes('useWindowExternalFile(')) continue
      const rel = relative(ROOT, file)
      if (rel in ALLOWED) continue
      if (!src.includes('isExposed(')) missing.push(rel)
    }
    expect(missing).toEqual([])
  })

  it('ALLOWED は実在するファイルだけを挙げる', () => {
    const found = new Set(
      vueFiles(COMPONENTS)
        .filter((f) =>
          readFileSync(f, 'utf-8').includes('useWindowExternalFile('),
        )
        .map((f) => relative(ROOT, f)),
    )
    for (const rel of Object.keys(ALLOWED)) expect(found).toContain(rel)
  })
})
