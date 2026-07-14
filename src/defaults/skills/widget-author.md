---
id: widget-author
name: ウィジェット作者
version: 1.1.1
description: 自然言語の依頼から AiScript ウィジェットを生成し、確認ダイアログ経由でユーザーに承認を取ってインストールするまでを担当するスキル。
mode: trigger
triggers:
  - プラグイン
  - ぷらぐいん
  - plugin
  - ウィジェット
  - ウィジット
  - widget
  - 小道具
  - aiscript
  - 自動化
  - 自動投稿
scope: global
builtIn: true
isPersona: false
---

# ウィジェット作者 — 自然言語 → AiScript (UI)

ユーザーが「○○を表示するウィジェット作って」「カウンタの小道具がほしい」など、
**画面に何かを描画する** 依頼をしたら、AiScript ソースを書いて
`widgets.create` capability を呼ぶ。インストール確認ダイアログはこちらでは
組み立てなくてよい (dispatcher が自動で MisStore カード風 UI を出す)。

ストリーム (新着ノート / 投稿前加工 / タイムライン表示) に介入したい場合は
**プラグイン** の領域なので `plugin-author` skill の方針に従って `plugins.create`
を呼ぶこと。

AiScript の文法・組込み関数・名前空間は別スキル `aiscript-author` に詳しく
まとめてある。書く前に必ずそちらを参照すること。

## 必ず守るフィードバックループ — validate → 修正 → re-validate

`widgets.create` / `widgets.update` を呼ぶ前に、**必ず**
`aiscript.validate` capability で src を構文検証する。

```
aiscript.validate({ src: "/// @ 0.16.0\nUi:render([...])", entryPoint: "widget" })
```

返り値:
- `{ ok: true, diagnostics: [] }` → そのまま `widgets.create` を呼ぶ
- `{ ok: false, diagnostics: [{ severity, message, line, column, ... }] }` →
  diagnostics を読んで src を修正し、再度 `aiscript.validate` を呼ぶ

このループを **最大 3 回** 回す。それでも直らないなら diagnostics をそのまま
ユーザーに見せて「ここで詰まりました」と相談する (= 黙って壊れた src を保存しない)。

### 二重防壁

`aiscript.validate` をスキップして直接 `widgets.create` を呼んでも、dispatcher
の preflight が同じ検証を走らせる。構文エラーがあれば確認ダイアログを出す**前**
に `{ ok: false, code: 'preflight_failed', error: '...diagnostics: [...]' }`
が tool_result で返るので、AI は自動的にループへ戻れる。

ただしユーザー体験的には事前 validate のほうが速いので、必ず
`aiscript.validate` を先に呼ぶこと。

## ウィジェットの最小構成

ウィジェットはハンドラを持たず、トップレベルで `Ui:render(...)` を呼ぶ。
メタヘッダはプラグインと違って **必須ではない** が、書くと管理しやすい。

```
/// @ 0.16.0
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

`Mk:save` / `Mk:load` でウィジェット固有領域に状態を持てる:

```
/// @ 0.16.0
var count = (Mk:load("count") or 0)

Ui:render([
  Ui:C:text({ text: `Count: {count}` })
  Ui:C:button({
    text: "+1"
    onClick: @() {
      count += 1
      Mk:save("count", count)
    }
  })
])
```

主要 UI コンポーネント (`Ui:C:*`) と組込み関数の一覧は `aiscript-author`
skill の「Ui: (ウィジェット UI 構築)」セクションを参照。

## `widgets.create` 呼び出し方

```
widgets.create({
  name: "ウィジェット名",
  src: "/// @ 0.16.0\nUi:render([...])",
  autoRun: false   // 省略可、default: false
})
```

`autoRun` の挙動:
- `false` (default, **推奨**) — カラム表示時に手動で「起動」ボタンを押す必要がある。
  ユーザーが意図せずコードが走るのを防ぐ
- `true` — カラム表示時に自動で AiScript が走る。ウィジェットに `Plugin:register_*`
  のようなフックはないが、`Mk:api` を叩くウィジェットなどは autoRun=true だと
  意図せずネットワークアクセスが発生する点に注意

**ユーザーが「すぐ動かしたい」「自動で表示したい」と明示しない限り
`autoRun: false` (= default) のままにすること**。後から `widgets.setAutoRun` で
切り替えられる (= 可逆な toggle 操作なので confirm なし)。

## 作成後にユーザーに伝えること

create が成功したら短く伝える:

> 「ウィジェット『○○』をインストールしました。ウィジェットカラムから
> 起動してください。」

`autoRun: true` で作った場合は「カラムを開くと自動で動きます」と一言添える。

## 既存ウィジェットの編集

ユーザーが「さっきのウィジェットを修正して」と言ったら:

1. `widgets.list` で対象を特定 (name で照合)
2. `widgets.read` で現状の src を取得
3. 必要な差分だけを反映した **全文** を書く
4. `aiscript.validate` で構文検証 (上記ループ)
5. `widgets.update` を呼ぶ

`widgets.update` も確認ダイアログが出る (= ユーザー承認が必要)。

## 自動実行・削除・ロールバック

ユーザーから明示的に依頼されたら以下も呼べる:

- **`widgets.setAutoRun`**: `autoRun` の on/off を切り替える可逆操作なので
  confirm なしで即実行される。先回りで勝手に autoRun=true にしない
- **`widgets.delete`**: 不可逆削除 (`Mk:save` 領域も消える)。ユーザーが
  「もう要らない」「消して」とはっきり言ったときだけ呼ぶ
- **`widgets.revert`**: 編集履歴 (`widgets.history` で取得) の特定 index に
  戻す。ユーザーが「さっきの状態に戻して」と言ったときに使う

## やらないこと

- 先回りで勝手に `autoRun: true` にしない (ユーザー意図の明示が必要)
- ストリーム介入が必要な依頼をウィジェットで実装しようとしない (= plugin に振り分ける)
- 描画したいだけの依頼を無理に plugin にしない (= ハンドラがないなら widget)
- `aiscript.validate` をスキップしない (= シンタックスエラーで preflight に
  弾かれると無駄な round-trip になる)
