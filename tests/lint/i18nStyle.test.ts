// 「UI 文言 (locales/ja-JP.yml) の表記規則」を機械検査に落とす (#135 / #704)。
//
// 規則の正本は locales/GLOSSARY.md の「表記の規則」。移行の途中で画面ごとに
// 書き方がばらけていた (切替 / 切り替え、全角 / 半角括弧、英字と和文の間の
// 空白の有無 ...) ので一度揃えた。人の注意力に任せると再びばらけるため、
// 揃えた状態をここで固定する。
//
// バッククォートで囲んだコード片と {param} は検査しない。capability の表示名
// (_capabilities) は capabilities.json5 が正本なのでここでは見ない。

import { describe, expect, it } from 'vitest'
import { flatten, loadLocale, SOURCE_LANG } from '../../scripts/gen-i18n.ts'

const JA = '[\\u3041-\\u3096\\u30a1-\\u30fa\\u30fc\\u3400-\\u9fff\\u3005]'
const AN = '[A-Za-z0-9]'

/** [規則名, 違反を見つける正規表現] */
const RULES: [string, RegExp][] = [
  ['三点リーダーは ...', /…/],
  ['切替 → 切り替え', /切替/],
  ['読込 → 読み込み', /読込/],
  ['再読み込み → リロード', /再読み込み/],
  ['取消 → 取り消し', /取消/],
  ['済 → 済み', /済(?!み)/],
  ['既定 / default → デフォルト', /既定|\bdefault\b/],
  ['本当に〜？ → 〜しますか？', /本当に/],
  [
    '元に戻せない注記は「この操作は取り消せません。」',
    /元に戻せません|復元できません/,
  ],
  // 状態を表す名詞 (「失敗」「連続失敗」) は対象外。動作の失敗を知らせる文だけ
  [
    '〜失敗 → 〜に失敗しました',
    /(?:保存|インストール|更新|読み込み|リセット|取得|削除|追加|作成|送信|接続)失敗|失敗:/,
  ],
  ['全角括弧 → 半角括弧', /[（）]/],
  ['和文の後の ? ! は全角', new RegExp(`${JA}[?!]`)],
  ['句点の後に空白を入れない', /。 /],
  [
    'カタカナ語の語尾は長音',
    /(?:プレースホルダ|ビューア|セレクタ|ヘッダ|フィルタ|パラメータ|ブラウザ|エディタ|プロバイダ|マネージャ|コンピュータ|メンバ|ユーザ|サーバ)(?!ー)/,
  ],
  ['英数字と和文の間は空白', new RegExp(`${JA}${AN}|${AN}${JA}`)],
  ['和文の後の ( の前は空白', new RegExp(`${JA}\\(`)],
  ['確認のキャンセルは「キャンセル」', /^やめる$/],
]

/**
 * 検査しない部分 (コード片と {param}) を、どの規則にも当たらない記号に潰す
 * (空白に潰すと「。{file} は」が「句点の後の空白」に見えてしまう)
 */
function prose(text: string): string {
  return text.replace(/`[^`]*`|\{\w+\}/g, '〇')
}

function styleViolations(text: string): string[] {
  const body = prose(text)
  return RULES.filter(([, re]) => re.test(body)).map(([name]) => name)
}

describe('UI 文言の表記規則 (#135 / #704)', () => {
  it('検出器は規則違反を拾い、コード片と {param} は見ない (自己検査)', () => {
    expect(styleViolations('Web UIで開く')).toEqual(['英数字と和文の間は空白'])
    expect(styleViolations('保存に失敗しました（{code}）')).toEqual([
      '全角括弧 → 半角括弧',
    ])
    expect(styleViolations('モード切替')).toEqual(['切替 → 切り替え'])
    expect(styleViolations('保存失敗: {error}')).toEqual([
      '〜失敗 → 〜に失敗しました',
    ])
    expect(styleViolations('`keybinds.reset` で {n}件')).toEqual([])
    expect(styleViolations('Web UI で開く')).toEqual([])
  })

  it('正本 (ja-JP) の文言は表記規則に従う', () => {
    const violations = [...flatten(loadLocale(SOURCE_LANG))]
      .filter(([key]) => !key.startsWith('_capabilities.'))
      .flatMap(([key, value]) => {
        const texts = typeof value === 'string' ? [value] : Object.values(value)
        return texts
          .filter((t): t is string => typeof t === 'string')
          .flatMap((t) => styleViolations(t).map((rule) => `${key}: ${rule}`))
      })
    expect(violations, '規則は locales/GLOSSARY.md の「表記の規則」').toEqual(
      [],
    )
  })
})
