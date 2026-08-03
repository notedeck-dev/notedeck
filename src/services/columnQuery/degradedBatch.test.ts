import { describe, expect, it, vi } from 'vitest'
import { createDegradedBatchRunner } from './degradedBatch'

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  text: 'hello',
  cw: null,
  visibility: 'public',
  files: [],
  ...over,
})

describe('createDegradedBatchRunner: 評価', () => {
  it('サブセット外の式を評価して match/unmatch を返す', () => {
    const runner = createDegradedBatchRunner()
    // str.len は QIR サブセット外 (V20) なので降格経路でしか評価できない
    const out = runner.run(
      [{ key: 'f1', source: 'note.text != null && note.text.len > 3' }],
      [note({ text: 'hello' }), note({ text: 'hi' })],
    )
    expect(out.verdicts).toEqual(['match', 'unmatch'])
    runner.dispose()
  })

  it('評価エラーは error になりノートを除外する', () => {
    const runner = createDegradedBatchRunner()
    // text=null に対して null レシーバのプロパティ呼び出し → per-note エラー
    const out = runner.run(
      [{ key: 'f1', source: 'note.text.len > 3' }],
      [note({ text: 'hello' }), note({ text: null })],
    )
    expect(out.verdicts).toEqual(['match', 'error'])
    runner.dispose()
  })

  it('bool でない結果は error 扱いにする', () => {
    const runner = createDegradedBatchRunner()
    const out = runner.run([{ key: 'f1', source: 'note.text' }], [note()])
    expect(out.verdicts).toEqual(['error'])
    runner.dispose()
  })
})

describe('createDegradedBatchRunner: And 合成', () => {
  it('全フィルタが match のときだけ match', () => {
    const runner = createDegradedBatchRunner()
    const out = runner.run(
      [
        { key: 'f1', source: 'note.text != null && note.text.len > 3' },
        { key: 'f2', source: 'note.visibility == "public"' },
      ],
      [
        note({ text: 'hello', visibility: 'public' }),
        note({ text: 'hello', visibility: 'home' }),
      ],
    )
    expect(out.verdicts).toEqual(['match', 'unmatch'])
    runner.dispose()
  })

  it('除外が確定したノートは後続フィルタで再評価しない (短絡)', () => {
    const runner = createDegradedBatchRunner()
    const begun: string[] = []
    const out = runner.run(
      [
        { key: 'f1', source: 'note.visibility == "public"' },
        { key: 'f2', source: 'note.text != null && note.text.len > 3' },
      ],
      [note({ visibility: 'home', text: 'hello' })],
      { onFilterBegin: (k) => begun.push(k) },
    )
    expect(out.verdicts).toEqual(['unmatch'])
    // 短絡してもフィルタ単位の開始通知は出る (犯人特定のマーカー)
    expect(begun).toEqual(['f1', 'f2'])
    runner.dispose()
  })
})

describe('createDegradedBatchRunner: 犯人特定のマーカー (V23)', () => {
  it('評価するフィルタごとに開始を通知する', () => {
    const runner = createDegradedBatchRunner()
    const onFilterBegin = vi.fn()
    runner.run(
      [
        { key: 'a', source: 'note.text != null' },
        { key: 'b', source: 'note.cw == null' },
      ],
      [note()],
      { onFilterBegin },
    )
    expect(onFilterBegin.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    runner.dispose()
  })
})

describe('createDegradedBatchRunner: 実行不能なソース', () => {
  it('ソースが実行不能なフィルタは全ノートを error にして報告する', () => {
    const runner = createDegradedBatchRunner()
    const out = runner.run(
      [{ key: 'broken', source: 'note.text !=' }],
      [note(), note()],
    )
    expect(out.verdicts).toEqual(['error', 'error'])
    expect(out.invalidFilters).toHaveLength(1)
    expect(out.invalidFilters[0]?.key).toBe('broken')
    runner.dispose()
  })
})

describe('createDegradedBatchRunner: フィルタの再利用', () => {
  it('同じ key/source なら Interpreter を作り直さない', () => {
    const runner = createDegradedBatchRunner()
    const spec = [{ key: 'f1', source: 'note.text != null' }]
    runner.run(spec, [note()])
    expect(runner.cachedKeys()).toEqual(['f1'])
    runner.run(spec, [note()])
    expect(runner.cachedKeys()).toEqual(['f1'])
    runner.dispose()
  })

  it('source が変わったら作り直す', () => {
    const runner = createDegradedBatchRunner()
    runner.run([{ key: 'f1', source: 'note.text != null' }], [note()])
    const out = runner.run(
      [{ key: 'f1', source: 'note.cw != null' }],
      [note({ cw: null })],
    )
    expect(out.verdicts).toEqual(['unmatch'])
    runner.dispose()
  })

  it('dispose でキャッシュを解放する', () => {
    const runner = createDegradedBatchRunner()
    runner.run([{ key: 'f1', source: 'note.text != null' }], [note()])
    runner.dispose()
    expect(runner.cachedKeys()).toEqual([])
  })
})

describe('createDegradedBatchRunner: step 予算', () => {
  it('step 予算を超える式は error になり、次のノートに影響しない', () => {
    const runner = createDegradedBatchRunner()
    // 予算 (FILTER_MAX_STEP) を確実に超えるループ
    const out = runner.run(
      [
        {
          key: 'heavy',
          source: 'var i = 0\nfor (let _, 100000) { i += 1 }\ni > 0',
        },
        { key: 'light', source: 'note.text != null' },
      ],
      [note(), note()],
    )
    expect(out.verdicts).toEqual(['error', 'error'])
    runner.dispose()
  })

  it('step カウンタはノートごとに戻る (累積で誤爆しない)', () => {
    const runner = createDegradedBatchRunner()
    // 1 ノートあたりでは予算内だが、累積すると超える程度の式を多数ノートに適用
    const notes = Array.from({ length: 40 }, () => note({ text: 'hello' }))
    const out = runner.run(
      [{ key: 'f1', source: 'var i = 0\nfor (let _, 20) { i += 1 }\ni == 20' }],
      notes,
    )
    expect(out.verdicts.every((v) => v === 'match')).toBe(true)
    runner.dispose()
  })
})
