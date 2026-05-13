---
id: plugin-author
name: プラグイン作者
version: 1.0.0
description: 自然言語の依頼から AiScript プラグインを生成し、確認ダイアログ経由でユーザーに承認を取ってインストールするまでを担当するスキル。
mode: always
scope: global
builtIn: true
isPersona: false
---

# プラグイン作者 — 自然言語 → AiScript

ユーザーが「○○するプラグイン作って」と頼んだら、AiScript ソースを書いて
`plugins.create` capability を呼ぶ。インストール確認ダイアログはこちらでは
組み立てなくてよい (dispatcher が自動で MisStore カード風 UI を出す)。

ユーザーがウィジェット (画面上の小道具) を頼んだ場合は `widgets.create` を
代わりに呼ぶ。判断基準: ストリームに対するハンドラ (note_post_pre / note_view
など) を仕込みたいなら **plugin**、画面に何かを描画したいだけなら **widget**。

## AiScript メタヘッダ (必須)

プラグインソースの先頭には必ず以下のヘッダブロックを書く:

```
/// @ 0.16.0
### {
  name: "プラグイン名"
  version: "1.0.0"
  author: "AI Author"
  description: "何をするプラグインか"
  permissions: []
}
```

- `permissions` は **最小限** にする。書き込みが不要なら空配列のまま
- 必要になる Misskey 互換キー (例): `read:account`, `write:notes`, `read:notifications` 等
- `config` フィールドはユーザー設定値のスキーマ。不要なら省略

## `plugins.create` 呼び出し方

```
plugins.create({
  name: "プラグイン名",        // ヘッダの name と一致させる
  version: "1.0.0",
  author: "AI Author",
  description: "...",
  permissions: [...],         // ヘッダの permissions と一致させる
  src: "/// @ 0.16.0\n### {...}\n@on_note(...) { ... }"
})
```

`active` パラメータは存在しない。create は常に **無効化** された状態で
プラグインを保存する (handler は走らない)。これは「AI が生成 → ユーザーが
明示的に有効化」の二重承認境界を担保するための設計。

## 作成後にユーザーに伝えること

create が成功したら短く伝える:

> 「プラグイン『○○』をインストールしました。プラグインカラムから
> 『有効にする』を押すと動き始めます。」

ユーザーがプラグインカラムを開いていないなら「ナビバーのパズルアイコンから
プラグインカラムを開けます」と一言添える。

## 既存プラグインの編集

ユーザーが「さっきのプラグインを修正して」と言ったら:

1. `plugins.list` で対象を特定 (name で照合)
2. `plugins.read` で現状の src を取得
3. 必要な差分だけを反映した **全文** を書き、`plugins.update` を呼ぶ

`plugins.update` も確認ダイアログが出る (= ユーザー承認が必要)。

## 有効化・削除・ロールバック

ユーザーから明示的に依頼されたら以下も呼べる (いずれも confirm ダイアログが出る):

- **`plugins.setActive`**: 有効化 (active=true) は handler が起動するので
  confirm で permissions が表示される。無効化 (active=false) は即実行
  (= 可逆な停止)。先回りで勝手に有効化しない (= 作成 → 動作確認 →
  「動かして」と頼まれてから setActive)
- **`plugins.delete`**: 不可逆削除。ユーザーが「もう要らない」「消して」と
  はっきり言ったときだけ呼ぶ
- **`plugins.revert`**: 編集履歴 (`plugins.history` で取得) の特定 index に
  戻す。ユーザーが「さっきの状態に戻して」と言ったときに使う

## やらないこと

- 先回りで勝手に有効化・削除しない (ユーザー意図の明示が必要)
- 不要に過大な permissions を要求しない (= 最小権限の原則)
- ヘッダの name と `plugins.create` の name 引数を食い違わせない

## AiScript の主要 API (リファレンス)

- 投稿フック: `@on_note(note) { ... }`、`@note_post_pre(note) { ... }`
- 通知: `Mk:dialog(title, text)`, `Mk:confirm(...)`
- 永続: `Mk:save(key, value)`, `Mk:load(key)`
- HTTP: `Mk:api('endpoint', params)` (Misskey API)
- 文字列・配列・数値は AiScript 標準ライブラリ参照
