import { describe, expect, it } from 'vitest'
import type { Principal } from '@/permissions/principal'
import {
  COALESCE_WINDOW_MS,
  EDIT_HISTORY_SPECS,
  evictHistory,
  historyActorLabel,
  historyDiffPair,
  shouldCoalesceEdit,
  themeFromSnapshot,
} from './editHistory'

describe('EDIT_HISTORY_SPECS', () => {
  it('履歴を持つ種別すべてに spec がある', () => {
    expect(Object.keys(EDIT_HISTORY_SPECS).sort()).toEqual([
      'css',
      'memo',
      'plugin',
      'skill',
      'theme',
      'widget',
    ])
  })

  it('skill: markdown body を全文として扱う', () => {
    const spec = EDIT_HISTORY_SPECS.skill
    expect(spec.language).toBe('markdown')
    expect(spec.snapshotText({ body: '# 見出し' })).toBe('# 見出し')
    expect(spec.revertParams('sk-1', 2)).toEqual({ id: 'sk-1', index: 2 })
  })

  it('plugin / widget: AiScript src を全文として扱う', () => {
    expect(EDIT_HISTORY_SPECS.plugin.language).toBe('aiscript')
    expect(EDIT_HISTORY_SPECS.plugin.snapshotText({ src: 'let x = 1' })).toBe(
      'let x = 1',
    )
    expect(EDIT_HISTORY_SPECS.widget.revertParams('w-1', 0)).toEqual({
      installId: 'w-1',
      index: 0,
    })
  })

  it('theme: props だけでなくテーマ全体を JSON として見せる', () => {
    const text = EDIT_HISTORY_SPECS.theme.snapshotText({
      id: 't1',
      name: 'T',
      base: 'dark',
      props: { accent: '#f00' },
    })
    expect(text).toContain('"name": "T"')
    expect(text).toContain('"accent": "#f00"')
    expect(EDIT_HISTORY_SPECS.theme.language).toBe('json5')
  })

  it('css: 単一ファイルなので revert に id を渡さない', () => {
    expect(EDIT_HISTORY_SPECS.css.revertParams('', 1)).toEqual({ index: 1 })
    expect(EDIT_HISTORY_SPECS.css.snapshotText({ body: '.a{}' })).toBe('.a{}')
  })

  it('壊れた snapshot は空文字にする (履歴表示で落とさない)', () => {
    for (const spec of Object.values(EDIT_HISTORY_SPECS)) {
      expect(spec.snapshotText(null)).toBe('')
      expect(spec.snapshotText('not an object')).toBe('')
    }
  })
})

describe('themeFromSnapshot', () => {
  it('snapshot からテーマ本体を復元する', () => {
    expect(
      themeFromSnapshot({
        id: 't1',
        name: 'T',
        base: 'light',
        props: { accent: '#f00' },
      }),
    ).toEqual({
      id: 't1',
      name: 'T',
      base: 'light',
      props: { accent: '#f00' },
    })
  })

  it('欠けたフィールドは既定値で埋める', () => {
    expect(themeFromSnapshot(null)).toEqual({
      id: '',
      name: '',
      base: 'dark',
      props: {},
    })
  })
})

describe('historyActorLabel', () => {
  it('本人の編集は「自分」と出す (帰属表示なしにしない)', () => {
    expect(historyActorLabel({ kind: 'user' })).toBe('自分')
  })

  it('AI のチャットと HEARTBEAT を別ラベルにする', () => {
    expect(historyActorLabel({ kind: 'ai.chat' })).toBe('AI')
    expect(historyActorLabel({ kind: 'ai.heartbeat' })).toBe('HEARTBEAT')
  })

  it('プラグインは配布名で見分けられる', () => {
    expect(
      historyActorLabel({ kind: 'plugin', pluginId: 'p1', name: 'AtCoder' }),
    ).toBe('プラグイン「AtCoder」')
  })

  it('記録が無いエントリ (帰属を記録する前の履歴) は「自分」に倒さない', () => {
    expect(historyActorLabel(undefined)).toBe('記録なし')
  })
})

describe('shouldCoalesceEdit', () => {
  const user: Principal = { kind: 'user' }

  it('直前が無ければ畳まない', () => {
    expect(shouldCoalesceEdit(undefined, { at: 1000, by: user })).toBe(false)
  })

  it('本人の連続保存が窓の内側なら新しい push を捨てる', () => {
    const prev = { at: 1000, by: user }
    expect(shouldCoalesceEdit(prev, { at: 1000 + 20_000, by: user })).toBe(true)
  })

  it('窓を越えたら畳まない (別の編集の区切りとして積む)', () => {
    const prev = { at: 1000, by: user }
    expect(
      shouldCoalesceEdit(prev, { at: 1000 + COALESCE_WINDOW_MS, by: user }),
    ).toBe(false)
  })

  it('帰属が未記録のエントリも本人の編集として畳む', () => {
    expect(shouldCoalesceEdit({ at: 1000 }, { at: 2000, by: user })).toBe(true)
  })

  it('AI の連続した編集は畳まない (1 回ごとに理由が付くため)', () => {
    const ai: Principal = { kind: 'ai.chat' }
    expect(shouldCoalesceEdit({ at: 1000, by: ai }, { at: 2000, by: ai })).toBe(
      false,
    )
  })

  it('本人と AI が混ざる連続編集は畳まない', () => {
    expect(
      shouldCoalesceEdit(
        { at: 1000, by: user },
        { at: 2000, by: { kind: 'ai.chat' } },
      ),
    ).toBe(false)
  })

  it('時刻が巻き戻っていたら畳まない', () => {
    expect(
      shouldCoalesceEdit({ at: 5000, by: user }, { at: 1000, by: user }),
    ).toBe(false)
  })
})

describe('evictHistory', () => {
  const user: Principal = { kind: 'user' }
  const ai: Principal = { kind: 'ai.chat' }
  // 新しい順 (index 0 が最新)
  const entry = (at: number, by?: Principal, reason?: string) => ({
    at,
    by,
    ...(reason ? { reason } : {}),
  })

  it('上限以内なら何も捨てない', () => {
    const entries = [entry(3, user), entry(2, user), entry(1, user)]
    expect(evictHistory(entries, 10)).toEqual(entries)
  })

  it('本人の理由なし編集を先に捨てる', () => {
    const entries = [
      entry(4, user),
      entry(3, ai, 'フック名を直すため'),
      entry(2, user),
      entry(1, user, '手で理由を書いた'),
    ]
    expect(evictHistory(entries, 3)).toEqual([
      entry(4, user),
      entry(3, ai, 'フック名を直すため'),
      entry(1, user, '手で理由を書いた'),
    ])
  })

  it('本人の理由なしが尽きたら理由付きより先に AI を残す', () => {
    const entries = [
      entry(3, ai, 'AI の編集'),
      entry(2, user, '理由付きの手編集'),
      entry(1, user),
    ]
    expect(evictHistory(entries, 1)).toEqual([entry(3, ai, 'AI の編集')])
  })

  it('同じ優先度なら古いものから捨てる', () => {
    const entries = [entry(3, user), entry(2, user), entry(1, user)]
    expect(evictHistory(entries, 2)).toEqual([entry(3, user), entry(2, user)])
  })

  it('保護対象しか無ければ最古を捨てる (無制限に増やさない)', () => {
    const entries = [entry(3, ai, 'a'), entry(2, ai, 'b'), entry(1, ai, 'c')]
    expect(evictHistory(entries, 2)).toEqual([
      entry(3, ai, 'a'),
      entry(2, ai, 'b'),
    ])
  })

  it('帰属が未記録のエントリは本人の理由なし編集として扱う', () => {
    const entries = [entry(3), entry(2, ai, 'AI の編集'), entry(1)]
    expect(evictHistory(entries, 2)).toEqual([
      entry(3),
      entry(2, ai, 'AI の編集'),
    ])
  })
})

describe('historyDiffPair', () => {
  const texts = ['三世代前', '二世代前', '一世代前']

  it('最新 snapshot は現在の内容と比べる', () => {
    expect(historyDiffPair(texts, 0, 'いまの内容')).toEqual({
      old: '三世代前',
      new: 'いまの内容',
    })
  })

  it('古い snapshot は 1 つ新しい snapshot と比べる (その編集の差分)', () => {
    expect(historyDiffPair(texts, 2, 'いまの内容')).toEqual({
      old: '一世代前',
      new: '二世代前',
    })
  })

  it('範囲外の index は null', () => {
    expect(historyDiffPair(texts, 3, 'x')).toBeNull()
    expect(historyDiffPair([], 0, 'x')).toBeNull()
  })
})
