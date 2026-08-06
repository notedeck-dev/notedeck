# カラムクエリ

カラムクエリは、カラムに流れてくるノートを絞り込むための式です。AiScript のサブセットで書き、**true を返したノートが表示されます**。「〇〇を隠す」を書くときは、条件を書いてから全体を `!(...)` で包みます。

```is
/// @ 1.2.1
// 特定のキーワードを含むノートを隠す — true = 表示
!(note.text != null && note.text.lower().incl("ネタバレ"))
```

カラム設定のフィルタから編集して保存します。複数のクエリは And で合成されるため、1 本のクエリには 1 つの機能だけ持たせるのが扱いやすくなります。

## 参照できるもの

式の中から自由に参照できるのは `note` だけです。次のフィールドは高速に評価でき、ローカルに溜まったノートの検索にも使えます。

```
note.text  note.cw  note.visibility  note.localOnly
note.renoteId  note.replyId
note.user.username  note.user.host  note.user.name
note.files.len  note.reactions["絵文字名"]
```

比較と論理演算、文字列の `incl` / `starts_with` / `ends_with` / `lower` / `upper`、配列の `incl` / `len`、`let`、再帰しない純粋な関数が使えます。

この範囲を外れるフィールド（`note.user.isCat`、`note.channelId`、`note.renote.text`、`note.poll` など）も動きますが、1 件ずつ評価する遅い経路に落ちます。結果は変わらず、速度だけの違いです。

## 書くときの注意

- **null を `&&` の短絡で避ける** — `note.text` / `note.cw` / `note.user.name` は null になることがあります。`note.text != null && note.text.incl("x")` の形にします。`let` は先に評価されるためガードになりません
- **二項演算子の後ろで改行しない** — 式は 1 行に収めるか、関数に切り出します
- **外部と通信できない** — `Mk:api` や現在時刻の取得、非同期処理は保存時に拒否されます
- **ハッシュタグ専用のフィールドはない** — 本文の文字列一致で代用します。前方一致で意図しないタグにも当たる点に注意してください
- **カラム設定に既にあるものは作らない** — リノート除外、リプライ除外、メディアのみ、bot 除外はトグルで用意されています

## 入れる・配る

[ストア](/docs/guide/store)から入れたクエリをそのまま使うことも、編集して自分用に直すこともできます。作ったものは [MisStore](https://store.notedeck.io) で配布できます（[提出のしかた](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [書式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#クエリ)）。
