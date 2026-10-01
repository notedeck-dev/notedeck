/**
 * 巡回の手順 (mode: heartbeat の skill 本文) が「実質空」かの判定 (#1162)。
 *
 * notemaid の `workspace::is_effectively_empty` と同じ定義 (OpenClaw の
 * empty-heartbeat-file + frontmatter): 空行 / HTML コメント / 見出し / fence /
 * 空のチェックリストだけなら空。notemaid はこの条件で tick を skip するので、
 * デバイスは同じ判定で「巡回の手順が空です」を出す。
 */

const STUB_LINES = new Set(['-', '- [ ]', '- []', '* [ ]', '*', '- [x]'])

export function isHeartbeatStepsEmpty(text: string): boolean {
  let s = text
  // 先頭の frontmatter (`---` ... `---`) は無視する (store の body には無いが、
  // 生のファイル内容を渡されても同じ答えにする)
  if (s.startsWith('---')) {
    const rest = s.slice(3)
    const end = rest.indexOf('\n---')
    if (end >= 0) s = rest.slice(end + 4)
  }
  // HTML コメントを落とす (複数行可。閉じていなければ末尾まで)
  let cleaned = ''
  let rest = s
  for (;;) {
    const i = rest.indexOf('<!--')
    if (i < 0) break
    cleaned += rest.slice(0, i)
    const j = rest.indexOf('-->', i + 4)
    if (j < 0) {
      rest = ''
      break
    }
    rest = rest.slice(j + 3)
  }
  cleaned += rest
  return cleaned.split('\n').every((l) => {
    const t = l.trim()
    return (
      t === '' ||
      t.startsWith('#') ||
      t.startsWith('```') ||
      t.startsWith('~~~') ||
      STUB_LINES.has(t)
    )
  })
}
