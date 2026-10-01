/**
 * 人格と記憶のファイル (USER / MEMORY) を項目単位で編む純ロジック (#1162 段階 4 UI)。
 *
 * ファイルの正本と書込は notemaid (`crates/notemaid/src/workspace.rs`) で、
 * ここは UI の「行の inline 編集 / 削除 / すべて忘れる」のために、写しの本文
 * (markdown) を手元で書き換えて全文を返すだけ。項目の切り方は notemaid の
 * `entries()` と同じ:
 *
 * - MEMORY: `- ` で始まる行 (続く字下げ行は同じ項目)
 * - USER: `<!-- observed: DATE | status: STATUS -->` の marker 行 + 続く箇条書き
 *   (OpenClaw user-model)。現役 (active) だけが項目。superseded は履歴
 */

export type EditableWorkspaceKind = 'user' | 'memory'

interface Span {
  /** 行番号 (含む) */
  start: number
  /** 行番号 (含まない) */
  end: number
  /** 畳んだ本文 (notemaid の entries と同じ) */
  text: string
}

interface UserBlock extends Span {
  status: string
}

function splitLines(body: string): string[] {
  return body.split('\n')
}

function stripBullet(line: string): string {
  const t = line.trim()
  return (t.startsWith('- ') ? t.slice(2) : t).trim()
}

function memoryEntries(lines: string[]): Span[] {
  const out: Span[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith('- ') || line === '-') {
      const start = i
      let j = i + 1
      while (j < lines.length) {
        const l = lines[j] ?? ''
        if (l.trim() === '' || !l.startsWith('  ') || l.startsWith('- ')) break
        j++
      }
      const text = lines
        .slice(start, j)
        .map((l) => stripBullet(l))
        .join(' ')
        .trim()
      out.push({ start, end: j, text })
      i = j
    } else {
      i++
    }
  }
  return out
}

function parseMarkerStatus(line: string): string | null {
  const t = line.trim()
  if (!(t.startsWith('<!--') && t.endsWith('-->') && t.includes('observed:'))) {
    return null
  }
  const inner = t.slice(4, -3)
  let status = 'active'
  for (const part of inner.split('|')) {
    const p = part.trim()
    if (p.startsWith('status:')) status = p.slice('status:'.length).trim()
  }
  return status
}

function userBlocks(lines: string[]): UserBlock[] {
  const out: UserBlock[] = []
  let i = 0
  while (i < lines.length) {
    const status = parseMarkerStatus(lines[i] ?? '')
    if (status !== null) {
      const start = i
      let j = i + 1
      while (
        j < lines.length &&
        (lines[j] ?? '').trimStart().startsWith('- ')
      ) {
        j++
      }
      const text = lines
        .slice(start + 1, j)
        .map((l) => stripBullet(l))
        .join(' ')
      out.push({ start, end: j, status, text })
      i = j
    } else {
      i++
    }
  }
  return out
}

/** 現役の項目を Span で返す (USER は active だけ) */
function activeSpans(kind: EditableWorkspaceKind, lines: string[]): Span[] {
  if (kind === 'memory') return memoryEntries(lines)
  return userBlocks(lines).filter((b) => b.status === 'active')
}

/** 本文の末尾に改行が 1 つあったか (書き戻しで保つ) */
function join(lines: string[]): string {
  return lines.join('\n')
}

/** 本文を 1 行の箇条書きにする (複数行の入力は空白で畳む) */
function bulletLine(text: string): string {
  const t = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' ')
  return `- ${t}`
}

/**
 * `entryText` に一致する項目を消した本文。見つからなければ `null` (写しが古い)。
 * USER は marker 行ごと消す。
 */
export function removeEntry(
  kind: EditableWorkspaceKind,
  body: string,
  entryText: string,
): string | null {
  const lines = splitLines(body)
  const hit = activeSpans(kind, lines).find((s) => s.text === entryText)
  if (!hit) return null
  // 項目の直後が空行で、直前も空行 (または先頭) なら空行を 1 つ畳む
  let end = hit.end
  if (
    (lines[end] ?? null) === '' &&
    (hit.start === 0 || lines[hit.start - 1] === '')
  ) {
    end++
  }
  lines.splice(hit.start, end - hit.start)
  return join(lines)
}

/**
 * `oldText` に一致する項目の本文を `newText` に書き換えた本文。見つからなければ
 * `null`。USER は marker 行 (observed / status) を保ち、箇条書きだけ差し替える。
 * 空文字への置換は削除と同じ。
 */
export function replaceEntry(
  kind: EditableWorkspaceKind,
  body: string,
  oldText: string,
  newText: string,
): string | null {
  if (newText.trim() === '') return removeEntry(kind, body, oldText)
  const lines = splitLines(body)
  const hit = activeSpans(kind, lines).find((s) => s.text === oldText)
  if (!hit) return null
  const bulletStart = kind === 'user' ? hit.start + 1 : hit.start
  lines.splice(bulletStart, hit.end - bulletStart, bulletLine(newText))
  return join(lines)
}

/**
 * 項目をすべて消してテンプレの骨だけ残す: 先頭の見出し行と、その直後にある
 * HTML コメント (説明文) だけ。USER の superseded (履歴) も消す。
 */
export function forgetAll(body: string): string {
  const lines = splitLines(body)
  const kept: string[] = []
  let i = 0
  // 先頭の空行を飛ばして見出し
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  if (i < lines.length && (lines[i] ?? '').startsWith('# ')) {
    kept.push(lines[i] ?? '')
    i++
  }
  // 見出しの直後 (空行を挟んでよい) の HTML コメントブロック。項目の marker
  // (`observed:`) は項目なので残さない
  let j = i
  while (j < lines.length && (lines[j] ?? '').trim() === '') j++
  const first = (lines[j] ?? '').trim()
  if (first.startsWith('<!--') && !first.includes('observed:')) {
    let k = j
    while (k < lines.length && !(lines[k] ?? '').trimEnd().endsWith('-->')) k++
    if (k < lines.length) {
      if (kept.length > 0) kept.push('')
      kept.push(...lines.slice(j, k + 1))
    }
  }
  if (kept.length === 0) return ''
  return `${kept.join('\n')}\n`
}
