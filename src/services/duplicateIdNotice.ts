import { i18n } from '@/i18n'

/** 読込で ID が重複してスキップしたファイル (1 回の loadAll 分) */
export interface DuplicateIdEntry {
  id: string
  file: string
}

/**
 * 重複 ID の通知文を 1 回の読込につき 1 本にまとめる。ファイルごとに出すと、
 * 同じ ID のファイルが溜まった環境では起動のたびにトーストが並ぶ (#913 の
 * 「ファイルは消さず手動解決に委ねる」方針はそのまま)。
 */
export function formatDuplicateIdNotice(
  entries: readonly DuplicateIdEntry[],
): string | null {
  if (entries.length === 0) return null
  if (entries.length === 1) {
    const [e] = entries
    return i18n.tsx._duplicateIdNotice.single({
      id: String(e?.id),
      file: String(e?.file),
    })
  }
  const byId = new Map<string, string[]>()
  for (const e of entries) {
    const files = byId.get(e.id) ?? []
    files.push(e.file)
    byId.set(e.id, files)
  }
  const detail = [...byId]
    .map(([id, files]) =>
      i18n.tsx._duplicateIdNotice.entry({ id, files: files.join(', ') }),
    )
    .join(' / ')
  return i18n.tsx._duplicateIdNotice.multiple_plural({
    count: entries.length,
    detail,
  })
}
