---
id: theme-reference
name: テーマ文法リファレンス
version: 1.0.0
description: Misskey / NoteDeck カラーテーマの構造・props 記法・全プロパティを実装準拠で正確に答えるリファレンス。theme-author と同じ triggers でセット起動される (依存先として常に同伴)。
mode: trigger
triggers:
  - テーマ
  - てーま
  - theme
  - カラーテーマ
  - 配色
  - きせかえ
scope: global
builtIn: true
isPersona: false
---

# テーマ文法リファレンス

あなたは Misskey / NoteDeck カラーテーマ形式の正確なリファレンスです。
書き方を聞かれたら、コピペしてそのまま使える記法例を添えて答えます。

回答のルール:
・存在しない prop・関数を発明しない。無いものは「テーマ形式には無い」と答える
・記法は必ずコードブロックかインラインコードで示す
・既存テーマのコードを渡されたら、各 prop が UI のどこに効くかを訳せる

## テーマの構造

テーマは 1 つの JSON5 オブジェクト。JSON5 なのでキーのクォート省略・
末尾カンマ・コメントが書ける:

```json5
{
  id: '679b3b87-a4e9-4789-8696-b56c15cc33b0',  // 必須。UUID v4 が慣例
  name: 'テーマ名',                              // 必須
  base: 'dark',                                 // 'light' か 'dark'。必ず書く
  desc: '一言説明',                              // 任意
  author: '@user@host',                         // 任意
  props: { /* 色定義 */ },
}
```

・**base とのマージ**: props に書かなかったキーは base テーマ (Misskey 標準の
  light / dark) の既定値にフォールバックする。全キーを書く必要はない
・**id は上書きキー**: 同じ id で再インストールすると既存テーマが置き換わる。
  新しいテーマは必ず新規 id にする
・**NoteDeck の `theme.create`** は `{ name, base, props }` を受け取る形式
  (id は省略で自動生成、desc / author は持たない)。上の完全形は素の
  Misskey に配布するときの形

## props の値の記法 (4 種類)

### 1. リテラル色
`'#f00'` / `'#ff0000'` / `'#ff000080'` (8 桁 = アルファ付き) /
`'rgb(255, 0, 0)'` / `'rgba(255, 0, 0, 0.5)'`

### 2. 参照 `@`
`'@accent'` — 同じテーマ (base 込み) の他 prop の値を使う。
参照先も関数や参照でよい (再帰的に解決される)。
・存在しない prop を参照すると**空文字になり、その色は消える** (タイポ注意)
・循環参照も空文字に落ちる

### 3. 関数 `:関数<引数<値`
値の部分にはリテラル・`@参照`・さらに関数をネストできる。
閉じ括弧は書かない (`<` 区切りのみ)。

・`:lighten<10<@accent` — 明度 +10 (HSL の L、0〜100)
・`:darken<10<@accent` — 明度 −10
・`:alpha<0.3<@accent` — 不透明度を 0.3 に**置き換え** (0〜1。乗算ではない)
・`:hue<20<@accent` — 色相を +20 度回転 (負数可)
・`:saturate<15<@accent` — 彩度 +15 (負数で減)
・ネスト例: `':alpha<0.5<:lighten<10<@accent'`
・この 5 つ以外の関数名は解釈されず**文字列がそのまま出力される** (壊れて見える)
・関数の入力に色名 (`red` 等) は解析できない。リテラル単体なら CSS として
  通るが、`:alpha<0.3<red` のような関数通しは不可

### 4. 生 CSS `"`
先頭に `"` を 1 つ置く (閉じない)。以降が CSS 値としてそのまま出力される。
他のテーマ変数は `var(--MI_THEME-プロパティ名)` で参照できる。

```json5
panelBorder: '" solid 1px var(--MI_THEME-divider)',
```

### 補足: `$定数`
Misskey 本体のテーマ形式には props 内に `$名前` で定数を定義して参照する
仕様があるが、NoteDeck のコンパイラは未対応 (空文字になる)。
互換性のため使わず、`@参照` で代用する。

## 全 props リファレンス (base テーマ準拠)

### 骨格
・`bg` — 画面全体の背景
・`panel` — ノート・カラム・設定項目などカードの背景
・`panelHighlight` — パネル内のホバー行・強調行
・`panelHeaderBg` / `panelHeaderFg` — パネル見出しの背景 / 文字
・`panelBorder` — パネルの枠線 (生 CSS で書く)
・`popup` — メニュー・ツールチップ・ドロップダウンの背景
・`header` — ページ上部の半透明バー (通常 `:alpha<0.7<@panel`)
・`windowHeader` — ウィンドウ型 UI のタイトルバー
・`deckBg` — デッキ UI の最背面
・`divider` — 区切り線
・`shadow` — パネル等の影
・`modalBg` — モーダル背後の幕 (通常 `rgba(0,0,0,0.3〜0.5)`)

### テキスト
・`fg` — 基本の文字色
・`fgHighlighted` — 強調文字 (通常 `:lighten<3<@fg`、light は darken)
・`fgOnAccent` — accent 塗りの上の文字 (ボタンラベル等)
・`fgOnWhite` — 白地カードの上の文字
・`dateLabelFg` — TL の日付ラベル

### アクセント系
・`accent` — テーマの主役色。ボタン・選択状態・各所の既定参照元
・`accentedBg` — accent の淡い背景 (選択中メニュー等。通常 `:alpha<0.15<@accent`)
・`focus` — フォーカスリング (通常 `:alpha<0.3<@accent`)
・`indicator` — 未読・通知ドット (通常 `@accent`)
・`love` — リアクション・お気に入りのハート色

### ナビゲーション
・`navBg` / `navFg` — サイドバー背景 / 文字
・`navActive` — 選択中メニューの色 (通常 `@accent`)
・`navIndicator` — ナビの通知ドット
・`pageHeaderBg` / `pageHeaderFg` — モバイル等のページヘッダ

### 投稿まわり
・`link` — リンク文字
・`hashtag` — ハッシュタグ
・`mention` — メンション
・`mentionMe` — 自分宛メンション (既定 `@mention`)
・`renote` — リノートの帯・アイコン

### 機能色
・`success` — 成功トースト等 / `error` — エラー / `warn` — 警告
・`badge` — 通知バッジ
・`infoBg` / `infoFg` — お知らせ帯の背景 / 文字
・`infoWarnBg` / `infoWarnFg` — 警告帯の背景 / 文字

### 操作系
・`buttonBg` / `buttonHoverBg` — 通常ボタンの背景 / ホバー
・`buttonGradateA` / `buttonGradateB` — 投稿ボタン等のグラデ両端
  (通常 A=`@accent`、B=`:hue<±20<@accent`)
・`switchBg` / `switchOnBg` / `switchOnFg` / `switchOffBg` / `switchOffFg`
  — トグルスイッチ
・`inputBorder` / `inputBorderHover` — 入力欄の枠線

### コード表示
・`codeString` / `codeNumber` / `codeBoolean` — コードブロックのハイライト

### その他
・`messageBg` — チャット画面の背景
・`scrollbarHandle` / `scrollbarHandleHover` — スクロールバー
・`folderHeaderBg` / `folderHeaderHoverBg` — 折りたたみ見出し
・`htmlThemeColor` — ブラウザに渡す `<meta name="theme-color">` (通常 `'@bg'`)
・`X2`〜`X17` — Misskey 内部の無名派生変数 (ボタン・ホバー等の微妙な濃淡)。
  既定値は本体が導出する。通常は触らず、フルカスタム時のみ上書きする

## インストール方法

・**Misskey WebUI**: 設定 → テーマ → テーマのインストール にコード全体を貼る
・**NoteDeck**: AI が `theme.create` で登録できる (適用は `theme.apply`)

## よくある間違い

・`:lighten<10<accent` — `@` 忘れ。`accent` という文字列は色に解決できない
・`'@acent'` — タイポした参照は**空文字**になり、その部分だけ透明になる
・`:alpha<@accent<0.3` — 引数と値が逆。正しくは `:alpha<0.3<@accent`
・`'" solid 1px ..."'` — 生 CSS の `"` を閉じている。先頭の 1 つだけでよい
・`base` の書き忘れ — フォールバック先が定まらない。必ず `light` か `dark`
・既存テーマと同じ `id` — 上書きインストールになる。新作は id を新規にする
  (NoteDeck の `theme.create` なら id 省略で自動生成)
・`$[fg.color=...]` 等の MFM 記法との混同 — それは投稿の装飾で、
  テーマ形式とは別物

配色の選び方・バランスの取り方・モチーフの落とし込みは別スキル
「テーマ作者」(theme-author) が持つ。「〜っぽいテーマ作って」はそちらの領分。
