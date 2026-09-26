// scripts/i18n-lint.ts (日本語の直書きを増やさないラチェット, #135) の数え方の検査。
// 比較そのものは git に依存するので CI / pre-push で走らせ、ここでは数え方だけ見る

import { describe, expect, it } from 'vitest'
import { count, isTarget } from '../../scripts/i18n-lint.ts'

describe('i18n-lint の数え方', () => {
  it('コメント以外の日本語を含む行を数える', () => {
    const text = [
      "const a = '保存しました'",
      '// コメントは数えない',
      '/* ブロック',
      '   コメントも */',
      '/** JSDoc も */',
      "const url = 'https://example.com' // 行末コメント",
      'show(`失敗: ${e}`)',
    ].join('\n')
    expect(count('src/a.ts', text).japanese).toBe(2)
  })

  it('Vue の template は数え、style と HTML コメントは数えない', () => {
    const text = [
      '<template>',
      '  <!-- 説明 -->',
      '  <span>こんにちは</span>',
      '</template>',
      '<style module>',
      '.a { content: "あ"; }',
      '</style>',
    ].join('\n')
    expect(count('src/A.vue', text).japanese).toBe(1)
  })

  it('Rust は #[cfg(test)] 以降を数えない', () => {
    const text = [
      'fn a() -> &str { "本番" }',
      '#[cfg(test)]',
      'mod tests { const X: &str = "テスト"; }',
    ].join('\n')
    expect(count('crates/x/src/a.rs', text).japanese).toBe(1)
  })

  it('i18n-ignore の行は免除として別に数え、語彙に無い理由を報告する', () => {
    const text = [
      "const a = 'にゃ' // i18n-ignore: mfm-spec",
      "const b = 'なんとなく' // i18n-ignore: because",
    ].join('\n')
    const c = count('src/a.ts', text)
    expect(c.japanese).toBe(0)
    expect(c.ignored).toBe(2)
    expect(c.badReasons).toEqual(['src/a.ts:2 (because)'])
  })

  it('locale の直書きを数える', () => {
    const text = [
      "new Intl.DateTimeFormat('ja-JP')",
      'date.toLocaleString()',
      "n.toLocaleString('ja')",
      'new Intl.DateTimeFormat(i18n.lang)',
      'date.toLocaleDateString(i18n.lang)',
    ].join('\n')
    expect(count('src/a.ts', text).hardLocale).toBe(3)
  })

  it('テスト・生成物・免除ファイルは対象外', () => {
    expect(isTarget('src/a.ts')).toBe(true)
    expect(isTarget('src/components/A.vue')).toBe(true)
    expect(isTarget('crates/notecore/src/a.rs')).toBe(true)
    expect(isTarget('src/a.test.ts')).toBe(false)
    expect(isTarget('src/a.dom.test.ts')).toBe(false)
    expect(isTarget('src/i18n/locale.generated.ts')).toBe(false)
    expect(isTarget('crates/notecore/src/capabilities/generated.rs')).toBe(
      false,
    )
    expect(isTarget('crates/notecore/tests/a.rs')).toBe(false)
    expect(isTarget('src/utils/nyaize.ts')).toBe(false)
    expect(isTarget('scripts/a.ts')).toBe(false)
  })
})
