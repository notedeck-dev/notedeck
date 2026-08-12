import type { MisskeyTheme } from '@/theme/types'

/**
 * 自己拡張系 write の「適用後全文」を計算する純関数群 (#981)。
 *
 * 確認ダイアログに全文 diff を出すには、承認より前に適用後の全文が要る。
 * 部分編集 (追記・セクション置換・props patch) も断片ではなく全文 diff で
 * 見せる方針なので、書込直前にやっていた計算を確認時点へ前倒しする。
 * 計算は store に置かず services 層で直接ユニットテストする (#782)。
 *
 * 確認で計算した結果をそのまま書き込む受け渡しは
 * `@/capabilities/stagedEdit` が担う (見せたものと書くものの一致)。
 */

/** 末尾に改行を 1 つだけ挟んで追記する (空の元テキストには区切りを入れない)。 */
export function appendBlock(base: string, content: string): string {
  const sep = base.length === 0 || base.endsWith('\n') ? '' : '\n'
  return `${base}${sep}${content}`
}

/**
 * `## <heading>` で始まるセクションを置換する。次に出現する `## ` / `# `
 * の直前までが置換対象。指定 heading が見つからない場合は本文末尾に新規
 * セクションとして追加する (= idempotent)。
 */
export function replaceMarkdownSection(
  body: string,
  heading: string,
  newContent: string,
): { body: string; replaced: boolean } {
  const lines = body.split('\n')
  const headingPattern = new RegExp(
    `^##\\s+${escapeRegExp(heading.trim())}\\s*$`,
  )
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (headingPattern.test(line)) {
      startIdx = i
      break
    }
  }

  if (startIdx < 0) {
    // 見つからない: 末尾に新規セクションを追加
    const prefix = body.endsWith('\n') || body.length === 0 ? body : `${body}\n`
    const sep = prefix.length === 0 ? '' : '\n'
    return {
      body: `${prefix}${sep}## ${heading}\n\n${newContent}`,
      replaced: false,
    }
  }

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^#{1,2}\s/.test(line)) {
      endIdx = i
      break
    }
  }

  const before = lines.slice(0, startIdx).join('\n')
  const after = lines.slice(endIdx).join('\n')
  const newSection = `## ${heading}\n\n${newContent}`
  const joined = [before, newSection, after]
    .filter((s, i) => i === 1 || s.length > 0)
    .join('\n')
  return { body: joined, replaced: true }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 確認 diff・履歴 diff・書込のすべてで使うテーマの全文表現 (#981)。
 * runtime-only の fileBase を落とすため、mergeThemeUpdate / themeFromSnapshot
 * を通した値を渡すこと。
 */
export function serializeTheme(theme: MisskeyTheme): string {
  return JSON.stringify(theme, null, 2)
}

/** `theme.update` の部分更新パッチ。未指定フィールドは現在値を維持する。 */
export interface ThemeUpdatePatch {
  name?: string
  base?: 'dark' | 'light'
  props?: Record<string, string>
}

/** 既存テーマに部分更新を当てた結果のテーマを返す (props は現在値とマージ)。 */
export function mergeThemeUpdate(
  current: MisskeyTheme,
  patch: ThemeUpdatePatch,
): MisskeyTheme {
  const merged: MisskeyTheme = {
    id: current.id,
    name: patch.name && patch.name.length > 0 ? patch.name : current.name,
    base: patch.base ?? current.base ?? 'dark',
    props: patch.props ? { ...current.props, ...patch.props } : current.props,
  }
  if (current.$notedeck) merged.$notedeck = current.$notedeck
  return merged
}
