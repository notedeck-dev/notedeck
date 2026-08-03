import { describe, expect, it } from 'vitest'

import {
  compileColumnQuery,
  QIR_MAX_NODES,
} from '@/services/columnQuery/compiler'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'

/**
 * QIR コンパイラの受理/拒否境界 (#783 v1 サブセット)。
 *
 * 受理側の代表フィクスチャは MisStore に配布済みの 11 クエリ:
 * 「ストア配布物は全部 v1 サブセット内 (⚡)」が配布時の設計意図なので、
 * ここでコンパイル可能性を CI に固定する (ストア側とセットの実地テスト)。
 */

// biome-ignore format: 配布ソースの引用
const STORE_QUERIES = {
  'calm-timeline': 'let is_pure_renote = note.renoteId != null && note.text == null\nlet is_reply = note.replyId != null\nlet is_direct = note.visibility == "specified"\n\n!is_pure_renote && !is_reply && !is_direct',
  'local-only': 'note.user.host == null',
  'keyword-hide': '@hit(lowered) {\n\tlowered.incl("懸賞") || lowered.incl("プレゼント企画") || lowered.incl("拡散希望")\n}\n\n!(note.text != null && hit(note.text.lower())) && !(note.cw != null && hit(note.cw.lower()))',
  'quotes-only': 'note.renoteId != null && note.text != null',
  'topic-watch': '@hit(lowered) {\n\tlowered.incl("notedeck") || lowered.incl("misskey")\n}\n\n(note.text != null && hit(note.text.lower())) || (note.cw != null && hit(note.cw.lower()))',
  'no-cw': 'note.cw == null',
  'non-public-only': 'note.visibility == "followers" || note.visibility == "specified"',
  'server-only': 'note.user.host == "misskey.io"',
  'hashtag-watch': '@hit(lowered) {\n\tlowered.incl("#技術書典") || lowered.incl("#photomisskey")\n}\n\nnote.text != null && hit(note.text.lower())',
  'no-federation': 'note.localOnly == true',
  'text-only': 'note.files == null || note.files.len == 0',
}

describe('compileColumnQuery: 受理 (MisStore 配布 11 クエリ = 全部 ⚡)', () => {
  it.each(Object.entries(STORE_QUERIES))('%s', (_id, source) => {
    const result = compileColumnQuery(source)
    expect(result.ok, result.ok ? '' : JSON.stringify(result.diagnostics)).toBe(
      true,
    )
  })

  it('コンパイル済み topic-watch が評価まで通る (統合スモーク)', () => {
    const compiled = compileColumnQuery(STORE_QUERIES['topic-watch'])
    if (!compiled.ok) throw new Error('unreachable')
    expect(evaluateQirQuery(compiled.query, { text: 'NoteDeck 便利' })).toBe(
      'match',
    )
    expect(evaluateQirQuery(compiled.query, { text: 'こんにちは' })).toBe(
      'unmatch',
    )
    expect(
      evaluateQirQuery(compiled.query, { text: null, cw: 'misskey話' }),
    ).toBe('match')
  })
})

describe('compileColumnQuery: 名前付きクエリ形 @(note) { ... }', () => {
  it('単一 fn 式は本体をフィルタとして受理する', () => {
    const result = compileColumnQuery('@(n) { n.text != null }')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(evaluateQirQuery(result.query, { text: 'x' })).toBe('match')
    expect(evaluateQirQuery(result.query, { text: null })).toBe('unmatch')
  })

  it('引数が 1 つでない fn 形は拒否する', () => {
    expect(compileColumnQuery('@(a, b) { true }').ok).toBe(false)
  })
})

describe('compileColumnQuery: 拒否 (サブセット外)', () => {
  const REJECTS: Record<string, string> = {
    'if 式': 'if note.text == null { false } else { true }',
    'return 文 (関数本体)': '@f(t) { return true }\nf(note.text)',
    'match 式':
      'match note.visibility { case "public" => true, default => false }',
    '名前空間関数 (Math:)': 'Math:abs(1) > 0',
    '副作用 API (Mk:)': 'Mk:api("notes/show") != null',
    再帰関数: '@f(t) { f(t) }\nf(true)',
    'var (mut)': 'var x = true\nx',
    'str.len': 'note.text != null && note.text.len > 3',
    'allowlist 外フィールド': 'note.tags != null',
    'allowlist 外フィールド (ネスト)': 'note.user.isBot == true',
    '2 引数 starts_with': 'note.text != null && note.text.starts_with("a", 1)',
    '非スカラー == (フィールド同士)': 'note.files == note.files',
    'arr リテラル': '["a", "b"].incl(note.visibility)',
    'obj リテラル': '{ a: 1 } != null',
    テンプレート文字列: 'note.text == `a{1}`',
    算術演算: 'note.files != null && note.files.len + 1 > 2',
    関数の第一級使用: '@f(t) { true }\nlet g = f\ng(1)',
    型注釈: 'let t: str = "a"\ntrue',
    'トップレベル非 bool': 'note.visibility',
    構文エラー: 'note.text !=',
    空ソース: '',
  }

  it.each(Object.entries(REJECTS))('%s', (_name, source) => {
    const result = compileColumnQuery(source)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('compileColumnQuery: 降格可否 (Phase 2 / V15)', () => {
  /** サブセット外だが純粋 = Worker で逐次適用する (🐢 降格) */
  const DEGRADABLE: Record<string, string> = {
    'if 式': 'if note.text == null { false } else { true }',
    'match 式':
      'match note.visibility { case "public" => true, default => false }',
    再帰関数: '@f(t) { f(t) }\nf(true)',
    'var (mut)': 'var x = true\nx',
    'str.len': 'note.text != null && note.text.len > 3',
    'allowlist 外フィールド': 'note.tags != null',
    '2 引数 starts_with': 'note.text != null && note.text.starts_with("a", 1)',
    'arr リテラル': '["a", "b"].incl(note.visibility)',
    テンプレート文字列: 'note.text == `a{1}`',
    算術演算: 'note.files != null && note.files.len + 1 > 2',
    関数の第一級使用: '@f(t) { true }\nlet g = f\ng(1)',
  }

  it.each(Object.entries(DEGRADABLE))('降格できる: %s', (_name, source) => {
    const result = compileColumnQuery(source)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.degradable).toBe(true)
  })

  /** 副作用・非決定 API に到達しうる = 降格させず保存時に拒否する */
  const REJECTED: Record<string, string> = {
    '名前空間関数 (Math:)': 'Math:abs(1) > 0',
    '副作用 API (Mk:)': 'Mk:api("notes/show") != null',
    '非決定 API (Date:)': 'Date:now() > 0',
    第一級で束縛しただけの非純粋関数: 'let f = Date:now\nf() > 0',
    構文エラー: 'note.text !=',
    空ソース: '',
  }

  it.each(Object.entries(REJECTED))('降格させない: %s', (_name, source) => {
    const result = compileColumnQuery(source)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.degradable).toBe(false)
  })

  it('非純粋な識別子は診断に名前と位置が出る', () => {
    const result = compileColumnQuery('note.text != null && Date:now() > 0')
    expect(result.ok).toBe(false)
    if (result.ok) return
    const found = result.diagnostics.find((d) => d.message.includes('Date:now'))
    expect(found).toBeDefined()
    expect(found?.line).toBe(1)
  })
})

describe('compileColumnQuery: 上限', () => {
  it('関数脱糖の指数爆発をノード数上限で打ち切る', () => {
    // f0 → f1 が f0 を 2 回 → ... 展開で 2^n 成長するチェーン
    const levels = 14
    const defs = ['@f0() { true }']
    for (let i = 1; i <= levels; i++) {
      defs.push(`@f${i}() { f${i - 1}() && f${i - 1}() }`)
    }
    const source = `${defs.join('\n')}\nf${levels}()`
    const result = compileColumnQuery(source)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.message).toContain('大きすぎ')
  })

  it(`ノード数上限は ${QIR_MAX_NODES}`, () => {
    // 上限内の大きめの式は通る (境界の健全性)
    const clauses = Array.from(
      { length: 100 },
      () => 'note.visibility == "public"',
    ).join(' || ')
    expect(compileColumnQuery(clauses).ok).toBe(true)
  })
})

describe('compileColumnQuery: 診断', () => {
  it('位置情報 (行) を含む', () => {
    const result = compileColumnQuery('let a = true\nMath:abs(1) > 0')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.line).toBe(2)
  })
})

describe('compileColumnQuery: nullable ガード診断 (V25)', () => {
  /** 警告が指しているフィールドパス */
  const warned = (source: string): string[] => {
    const result = compileColumnQuery(source)
    if (!result.ok) throw new Error(`compile failed: ${source}`)
    return result.warnings.map((w) => w.field)
  }

  it('unguarded な nullable フィールドの操作を警告する', () => {
    // 画像のみ・純リノートは text=null なので、このままだと全件エラー除外になる
    expect(warned('note.text.incl("a")')).toEqual(['note.text'])
  })

  it('ガードしてあれば警告しない', () => {
    expect(warned('note.text != null && note.text.incl("a")')).toEqual([])
  })

  it('別フィールドのガードでは解除されない', () => {
    expect(warned('note.cw != null && note.text.incl("a")')).toEqual([
      'note.text',
    ])
  })

  it('null 比較の左右が逆でもガードとして認める', () => {
    expect(warned('null != note.text && note.text.incl("a")')).toEqual([])
  })

  it('関数呼び出しの引数に渡す場合もガードが効く', () => {
    // MisStore 配布クエリと同じ形
    const src =
      '@hit(lowered) {\n\tlowered.incl("a")\n}\n\nnote.text != null && hit(note.text.lower())'
    expect(warned(src)).toEqual([])
  })

  it('nullable な配列の .len も警告する', () => {
    expect(warned('note.files.len > 0')).toEqual(['note.files'])
  })

  it('nullable でないフィールドは警告しない', () => {
    expect(warned('note.visibility == "public"')).toEqual([])
    expect(warned('note.user.username.incl("a")')).toEqual([])
  })

  it('同じフィールドを何度使っても警告は 1 件にまとめる', () => {
    expect(warned('note.text.incl("a") || note.text.incl("b")')).toEqual([
      'note.text',
    ])
  })

  it('ガードのスコープは and の右辺に限る', () => {
    // 左辺のガードは or をまたいだ先には効かない
    expect(
      warned(
        '(note.text != null && note.text.incl("a")) || note.text.incl("b")',
      ),
    ).toEqual(['note.text'])
  })

  it('警告にはガード式と位置が付く (quick-fix 用)', () => {
    const result = compileColumnQuery('note.text.incl("a")')
    if (!result.ok) throw new Error('compile failed')
    expect(result.warnings[0]?.guard).toBe('note.text != null')
    expect(result.warnings[0]?.line).toBe(1)
  })

  it('コンパイル自体は成功する (ブロッキングは UI 側の判断)', () => {
    expect(compileColumnQuery('note.text.incl("a")').ok).toBe(true)
  })
})

describe('compileColumnQuery: 名前付きクエリ形の nullable ガード (V25)', () => {
  it('引数名が note 以外でもガードを認識する', () => {
    // ガード検出はソース上の識別子で行うので、警告キーも同じ名前で作る必要がある
    const result = compileColumnQuery(
      '@(n) { n.text != null && n.text.incl("a") }',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
  })

  it('引数名が note 以外のときも unguarded は警告する', () => {
    const result = compileColumnQuery('@(n) { n.text.incl("a") }')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.map((w) => w.field)).toEqual(['n.text'])
    expect(result.warnings[0]?.guard).toBe('n.text != null')
  })
})
