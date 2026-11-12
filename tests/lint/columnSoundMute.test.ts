// 「音が鳴りうるカラムのヘッダーには、音声ミュートボタンがある」を機械検査に落とす (#1388)
//
// ノートを表示するカラムは、リアクションしたときに音が鳴る (`useColumnSetup` の
// 効果音。カラムの `soundMuted` を見る)。新着で鳴るかどうかに関わらず、止める手段が
// ヘッダーに要る。以前は「新着で鳴る、アカウントごとのストリーム系カラム」にしか
// ボタンが無く、全アカウントの各カラムや検索・お気に入りなどでは鳴るのに止められなかった。
//
// `<MkNote` を描くカラムは、自分が置くすべての `<DeckColumn>` に `sound-enabled` を
// 付ける。`DeckNoteColumn` / `DeckCrossSourcesColumn` に任せるカラムは、その 2 つが付ける。

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DECK = resolve(import.meta.dirname, '../../src/components/deck')

/** `<DeckColumn ...>` の開始タグ (属性ごと) を取り出す */
function deckColumnTags(source: string): string[] {
  return [...source.matchAll(/<DeckColumn(?=[\s>])[^>]*>/g)].map((m) => m[0])
}

describe('ノートを表示するカラムの音声ミュートボタン (#1388)', () => {
  it('<MkNote> を描くカラムは、置いた <DeckColumn> すべてに sound-enabled を付ける', () => {
    const missing: string[] = []
    for (const name of readdirSync(DECK)) {
      if (!/^Deck.*Column\.vue$/.test(name)) continue
      const source = readFileSync(join(DECK, name), 'utf8')
      if (!/<MkNote[\s>]/.test(source)) continue
      for (const tag of deckColumnTags(source)) {
        if (!/\bsound-enabled\b/.test(tag)) missing.push(name)
      }
    }
    expect(missing).toEqual([])
  })
})
