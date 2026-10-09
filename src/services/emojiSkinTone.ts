/**
 * Unicode 絵文字のスキントーン (#1193)。1〜5 が Fitzpatrick 修飾子
 * U+1F3FB〜U+1F3FF に対応し、null は修飾しない (黄色の既定)。
 */
export type SkinTone = 1 | 2 | 3 | 4 | 5

export const SKIN_TONES: readonly SkinTone[] = [1, 2, 3, 4, 5]

export function normalizeSkinTone(raw: unknown): SkinTone | null {
  return typeof raw === 'number' && SKIN_TONES.includes(raw as SkinTone)
    ? (raw as SkinTone)
    : null
}

const MODIFIER_BASE = /^\p{Emoji_Modifier_Base}$/u
const ZWJ = '\u200D'
const VS16 = '\uFE0F'
const HANDSHAKE = '\u{1F91D}'
const HEART = '\u2764'
// Emoji_Modifier_Base だが、同梱の Twemoji にトーン違いが無いもの
// (👯 / 🤼 / 👪)。新しい Unicode では定義されたものもあるが、描けないので付けない
const NO_TONE = new Set(['\u{1F46F}', '\u{1F93C}', '\u{1F46A}'])

/**
 * 絵文字にスキントーンを付ける。トーン違いが無い絵文字は元のまま返す。
 * 人の部分 (Emoji_Modifier_Base) それぞれに修飾子を付け、二人の絵文字を
 * つなぐ握手 (🧑‍🤝‍🧑 の 🤝) には付けない。複数人で付けてよいのは二人の
 * 絵文字 (握手 / ハートでつなぐもの) だけで、家族の絵文字にはトーン違いが無い。
 *
 * 判定を RegExp の \p{RGI_Emoji} に任せないのは、エンジンの Unicode 版で
 * 結果が変わり、Twemoji に画像が無いものまで通してしまうため。
 * 規則が同梱の画像と合っていることは emojiSkinTone.test.ts が検査する
 */
export function applySkinTone(char: string, tone: SkinTone | null): string {
  if (tone === null) return char
  const cps = Array.from(char)
  if (NO_TONE.has(cps[0] ?? '')) return char
  const isSequence = cps.includes(ZWJ)
  const modifier = String.fromCodePoint(0x1f3fa + tone)
  let out = ''
  let people = 0
  let toned = false
  for (const cp of cps) {
    // 修飾子を付けた直後の異体字セレクタは修飾子に置き換わるので落とす
    if (toned && cp === VS16) {
      toned = false
      continue
    }
    toned = false
    out += cp
    if (!MODIFIER_BASE.test(cp)) continue
    if (isSequence && cp === HANDSHAKE) continue
    out += modifier
    people++
    toned = true
  }
  if (people === 0) return char
  if (people > 1 && !cps.includes(HANDSHAKE) && !cps.includes(HEART)) {
    return char
  }
  return out
}
