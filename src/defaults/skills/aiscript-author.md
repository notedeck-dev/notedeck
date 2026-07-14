---
id: aiscript-author
name: AiScript 文法リファレンス
version: 1.2.0
description: AiScript 0.16 の値型・制御構文・名前空間付き組込み関数・プラグイン/ウィジェットのハンドラ規約を集約したリファレンス。plugin-author / widget-author と同じ triggers でセット起動される (依存先として常に同伴)。
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

# AiScript 0.16 文法リファレンス

NoteDeck のプラグイン・ウィジェットは AiScript 0.16 で書く。書き出す前に
このリファレンスで構文を確認し、`aiscript.validate` で必ず検証する。

公式ドキュメント: https://aiscript-dev.github.io/ja/

## メタヘッダ (プラグインは必須、ウィジェットは省略可)

```
/// @ 0.16.0
### {
  name: "Name"
  version: "1.0.0"
  author: "Author"
  description: "..."
  permissions: []
  config: {
    threshold: {
      type: "number"
      label: "閾値"
      default: 5
    }
  }
}
```

- `///` ヘッダ行は **半角空白の有無に厳密** (`/// @ 0.16.0`)
- `###` ブロック内はキー: 値 (カンマ不要)
- `config` は省略可。書くと UI で設定値を編集できる
- ウィジェット (`widgets.create`) はメタヘッダなしでも動くが、書くと管理しやすい

## 値型

| 型 | 例 | リテラル |
|---|---|---|
| num | `42`, `3.14`, `-1` | 整数 / 浮動小数 |
| str | `"hello"`, `'world'` | 二重引用符・単一引用符どちらも |
| bool | `true`, `false` | |
| null | `null` | |
| arr | `[1, 2, 3]` | |
| obj | `{ a: 1, b: 2 }` | キーは bare-word 可 |
| fn | `@(x) { x * 2 }` | 後述 |

## 変数宣言

```
let x = 1       // 不変 (再代入不可)
var y = 2       // 可変 (再代入可)
y = 3           // OK
y += 4          // OK (複合代入)
```

**落とし穴**: `let` で宣言した変数は再代入できない。ループ内で値を更新したい
変数は `var` を使う。

## 制御構文

```
if cond { ... } elif other { ... } else { ... }

for let i, 10 { ... }            // 0..9
each let item, arr { ... }       // 配列を走査

loop {
  if done break
  continue
}

match value {
  case 1 => "one"
  case 2 => "two"
  default => "other"
}
```

- `for` の上限は引数 2 つ目 (= `for let i, n` で `i` は 0 から `n-1`)
- `match` の各 arm は `=>` で続ける

## 関数

```
@greet(name: str): str {
  `Hello, {name}`              // テンプレ文字列は backtick + {expr}
}

let double = @(x) { x * 2 }    // 無名関数
```

- 引数の型注釈は `(name: type)` 形式
- 戻り値の型注釈は `): type {` 形式
- 関数本体最後の式が暗黙の戻り値 (return 不要)

## 配列・オブジェクトアクセス

```
let arr = [10, 20, 30]
arr[0]            // 10 — bracket index
arr.0             // 同じ意味、dot index も使える

let obj = { foo: 1 }
obj.foo           // 1
obj["foo"]        // 1
```

**落とし穴**: AiScript 0.16 では `arr:0` のような colon index 構文は使わない
(配列要素アクセスはあくまで bracket か dot)。

## 名前空間付き組込み

呼び出しは `Namespace:member(args)` のコロン記法。

### Mk: (Misskey 連携 — プラグイン専用)

| 関数 | 機能 |
|---|---|
| `Mk:dialog(title, text)` | モーダル表示 |
| `Mk:confirm(title, text)` | 確認ダイアログ (bool 返り) |
| `Mk:api(endpoint, params)` | Misskey API 呼び出し (例: `Mk:api('notes/create', { text: 'hi' })`) |
| `Mk:save(key, value)` | 永続保存 (プラグイン固有領域) |
| `Mk:load(key)` | 永続値取得 |
| `Mk:url()` | サーバー URL |

### Core: (基本ユーティリティ)

| 関数 | 機能 |
|---|---|
| `Core:v` | AiScript バージョン |
| `Core:type(x)` | 型名 |
| `Core:to_str(x)` | 文字列化 |
| `Core:sleep(ms)` | 待機 |
| `Core:abort(msg)` | 中断 |
| `Core:range(a, b)` | a..b の配列 |

### Math: / Str: / Arr: / Obj: / Json: / Date: / Async: / Uri: / Util: / Error:

代表的なもの:
- `Math:pi`, `Math:sin(x)`, `Math:floor(x)`, `Math:random()` (0..1)
- `Str:len(s)`, `Str:to_arr(s)`, `Str:upper(s)`, `Str:lower(s)`
- `Arr:len(a)`, `Arr:push(a, x)`, `Arr:map(a, fn)`, `Arr:filter(a, fn)`, `Arr:reduce(a, fn, init)`
- `Obj:keys(o)`, `Obj:vals(o)`, `Obj:has(o, key)`
- `Json:stringify(x)`, `Json:parse(s)`
- `Date:now()`, `Date:year()`, `Date:hour()`
- `Async:interval(ms, fn)`, `Async:timeout(ms, fn)`
- `Util:uuid()`

### Ui: (ウィジェット UI 構築)

`Ui:render([components])` でルートを描画。

```
Ui:render([
  Ui:C:text({ text: "Hello" })
  Ui:C:button({
    text: "Click"
    onClick: @() { Mk:dialog("clicked", "!") }
  })
])
```

主要コンポーネント (Ui:C:*):
- `text` — 静的テキスト
- `mfm` — MFM フォーマット文字列
- `button` — ボタン (`onClick` 必須)
- `textInput`, `numberInput` — 入力
- `switch`, `select` — トグル / 選択
- `container`, `folder` — レイアウト

## プラグインのフック (Plugin:register_*)

フック登録は Misskey 互換の `Plugin:register_*` API をトップレベルで呼ぶ。
`Plugin:register:note_action` のようなコロン区切り alias も同じ意味。

| API | ハンドラ | 発火場所 |
|---|---|---|
| `Plugin:register_note_action(title, fn)` | `fn(note)` | ノートの「…」メニュー |
| `Plugin:register_user_action(title, fn)` | `fn(user)` | ユーザーメニュー |
| `Plugin:register_post_form_action(title, fn)` | `fn(form, update)` | 投稿フォームのプラグインメニュー |
| `Plugin:register_note_view_interruptor(fn)` | `fn(note) → note` | タイムライン表示前に note を加工 |
| `Plugin:register_note_post_interruptor(fn)` | `fn(note) → note` | 投稿直前に note を加工 |
| `Plugin:register_page_view_interruptor(fn)` | `fn(page) → page` | Page 表示前に加工 |

```
Plugin:register_user_action("ユーザー情報", @(user) {
  Mk:dialog("info", user.username)
})

Plugin:register_post_form_action("CW を付ける", @(form, update) {
  // form は { text, cw }。update("text" | "cw", value) で書き換える
  update("cw", "auto CW")
})

Plugin:register_note_post_interruptor(@(note) {
  note.text = `{note.text} #tag`
  note                          // 加工した note を返すと差し替わる
})
```

- action 系 (`*_action`) は副作用のみ。interruptor 系は **加工後の値を返す**
- 引数 `note` / `user` は obj (`note.text`, `user.username` など)

## ウィジェットの本体

ウィジェットはハンドラを持たず、トップレベルで `Ui:render(...)` を呼ぶ
(または初期化処理を書く)。`Mk:save` / `Mk:load` で状態を持てる。

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

## よくある落とし穴 (= `aiscript.validate` で弾かれがち)

| 症状 | 原因 | 直し方 |
|---|---|---|
| `unexpected token` | `let` の再代入 | `var` に変える |
| `Reserved word "...". Line N` | `class` / `enum` / `import` 等の予約語をシンボル名に使った | 別名にする |
| `unexpected ":"` | `arr:0` で要素アクセス | `arr[0]` または `arr.0` |
| `unexpected EOF` | `### { ... }` の `}` を閉じ忘れ | 閉じる |
| `Math.pi` が undefined | `.` でなく `:` | `Math:pi` |
| フックが発火しない | `@on_note` 等の存在しないハンドラ規約で書いた、またはプラグインが無効のまま | `Plugin:register_*` で登録し、有効化する |

## 参考

- 公式リファレンス (型・全組込み): https://aiscript-dev.github.io/ja/reference/
- AiScript Playground (実行確認): https://aiscript-dev.github.io/aiscript/
