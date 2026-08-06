# ウィジェット

ウィジェットは小さな UI を画面に置くための拡張です。AiScript で書き、時計や集計、外部から取ってきたデータの表示などに使います。プラグインと違ってフックを持たず、実行すると描画するだけの単純な作りです。

## 最小構成

トップレベルで `Ui:render` を呼びます。メタヘッダはプラグインと違って必須ではありませんが、書いておくと管理しやすくなります。

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

UI は `Ui:C:*` のコンポーネントを並べて組み立てます。テキスト、ボタン、入力欄などが使えます。

## 状態を持つ

`Mk:save` と `Mk:load` でウィジェットごとの領域に値を残せます。再描画やアプリの再起動をまたいで保持されます。

```is
/// @ 1.2.1
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

## 自動実行

ウィジェットは既定では手動起動です。カラムを開いても勝手には走らず、「起動」を押したときに実行されます。自動実行に切り替えることもできますが、外部と通信するウィジェットでは、開いただけで通信が発生する点に注意してください。切り替えはいつでも戻せます。

## 作る・配る

AI カラムで「〇〇を表示するウィジェットを作って」と頼めます。手で書く場合は設定フォルダにコード本体とメタ情報の 2 ファイルを置きます。作ったものは [MisStore](https://store.notedeck.io) で配布できます（[提出のしかた](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [書式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)）。
