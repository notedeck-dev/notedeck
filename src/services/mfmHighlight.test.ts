import { describe, expect, it } from 'vitest'
import { type MfmHighlightRange, mfmHighlightRanges } from './mfmHighlight'

/** 範囲を「種類:文字列」の並びにして読みやすくする (fn は深さつき) */
function show(text: string): string[] {
  return mfmHighlightRanges(text).map((r) => {
    const s = text.slice(r.from, r.to)
    return r.depth === undefined ? `${r.kind}:${s}` : `${r.kind}${r.depth}:${s}`
  })
}

describe('mfmHighlightRanges', () => {
  it('関数は「$[名前」と閉じ括弧に、入れ子の深さを付ける', () => {
    expect(show('$[x2 a]')).toEqual(['fn0:$[x2', 'fn0:]'])
    expect(show('$[x2 $[spin a] b]')).toEqual([
      'fn0:$[x2',
      'fn1:$[spin',
      'fn1:]',
      'fn0:]',
    ])
  })

  it('関数の引数は名前と分けて示す', () => {
    expect(show('$[spin.speed=2s,alternate a]')).toEqual([
      'fn0:$[spin',
      'fnArgs0:.speed=2s,alternate',
      'fn0:]',
    ])
  })

  it('閉じていない関数は開きだけ、相手のいない ] はそのまま', () => {
    expect(show('$[x2 a')).toEqual(['fn0:$[x2'])
    expect(show('a] b')).toEqual([])
    // 名前の後に空白が無いものは関数ではない (本家の構文)
    expect(show('$[x2]')).toEqual([])
  })

  it('リンクの [ ] は関数の括弧と取り違えない', () => {
    expect(show('$[x2 [a](https://x.example/p)]')).toEqual([
      'fn0:$[x2',
      'url:https://x.example/p',
      'fn0:]',
    ])
  })

  it('装飾の記号・絵文字・メンション・ハッシュタグ・URL', () => {
    expect(show('**b** ~~s~~')).toEqual([
      'mark:**',
      'mark:**',
      'mark:~~',
      'mark:~~',
    ])
    expect(show('<center>:blob: @a @b@c.example #tag</center>')).toEqual([
      'mark:<center>',
      'emoji::blob:',
      'mention:@a',
      'mention:@b@c.example',
      'hashtag:#tag',
      'mark:</center>',
    ])
    expect(show('see https://x.example/a?b=1 ok')).toEqual([
      'url:https://x.example/a?b=1',
    ])
    // ハッシュタグは和文の句読点で切れる
    expect(show('#tag\u3002next')).toEqual(['hashtag:#tag'])
    // メールアドレスの @ や、語の途中の # はメンション / ハッシュタグではない
    expect(show('me@x.example a#b')).toEqual([])
  })

  it('コードと <plain> の中は解釈しない', () => {
    expect(show('`$[x2 a] :b:`')).toEqual(['code:`$[x2 a] :b:`'])
    expect(show('```\n$[x2 a]\n```')).toEqual(['code:```\n$[x2 a]\n```'])
    expect(show('<plain>$[x2 :a:]</plain> :b:')).toEqual([
      'mark:<plain>',
      'mark:</plain>',
      'emoji::b:',
    ])
  })

  it('範囲は重ならず、前から順に並び、文字列の中に収まる', () => {
    const text =
      '$[x2 **a** $[spin.speed=1s :b: @c #d https://e.example] `f`] ] g'
    const ranges: MfmHighlightRange[] = mfmHighlightRanges(text)
    let last = 0
    for (const r of ranges) {
      expect(r.from).toBeGreaterThanOrEqual(last)
      expect(r.to).toBeGreaterThan(r.from)
      expect(r.to).toBeLessThanOrEqual(text.length)
      last = r.to
    }
  })
})
