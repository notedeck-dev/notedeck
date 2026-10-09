/**
 * チャットの会話に挟む日付の区切り (#1207)。本家の timeline-date-separate と
 * 同じ考え方で、隣り合うメッセージの日付 (端末のタイムゾーン) が違う所に置く。
 *
 * 区切りは行として配列に挟まず、日付が変わった側のメッセージ id に紐づけて返す。
 * 仮想スクロールの index (最下部への追従・過去ログ読み込み後の位置復元) を
 * メッセージの並びのまま保つため。
 */

export interface ChatDateSeparator {
  /** 区切りより上 (古い側) の日付 */
  prevText: string
  /** 区切りより下 (新しい側) の日付 */
  nextText: string
}

function dateText(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 古い順に並んだメッセージから、直前と日付が変わったメッセージ id → 区切り */
export function chatDateSeparators(
  messages: readonly { id: string; createdAt: string }[],
): Map<string, ChatDateSeparator> {
  const out = new Map<string, ChatDateSeparator>()
  let prev: Date | null = null
  for (const m of messages) {
    const d = new Date(m.createdAt)
    if (prev && !sameDay(prev, d)) {
      out.set(m.id, { prevText: dateText(prev), nextText: dateText(d) })
    }
    prev = d
  }
  return out
}
