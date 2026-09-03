# プラグイン

プラグインは AiScript で書く拡張です。ノートやユーザーに操作を足したり、投稿する内容を書き換えたり、コマンドパレットにコマンドを生やしたりできます。Misskey 本体のプラグインと同じ考え方ですが、NoteDeck 独自の API が加わります。

## 最小構成

先頭にメタヘッダを書きます。AiScript のバージョン指定を省くと古いパーサで解釈され、後述の interruptor が使えません。

```is
/// @ 1.2.1
### {
  name: "サンプル"
  version: "1.0.0"
  author: "あなた"
  description: "何をするプラグインか"
  permissions: []
}
```

## 登録できるフック

`Plugin:register_*` でフックを登録します。プラグインは読み込み時に一度実行され、そこで登録した関数が後からイベントごとに呼ばれます。

| フック | 呼ばれるとき |
|---|---|
| `register_note_action` | ノートのメニューから選ばれたとき |
| `register_user_action` | ユーザーのメニューから選ばれたとき |
| `register_post_form_action` | 投稿フォームのボタンが押されたとき |
| `register_note_view_interruptor` | ノートを表示する直前 |
| `register_note_post_interruptor` | ノートを投稿する直前 |
| `register_page_view_interruptor` | ページを表示する直前 |
| `register_command` | コマンドとして呼ばれたとき |

::: warning interruptor は同期実行
`*_interruptor` は同期的に呼ばれるため、中で確認ダイアログを出すことはできません。投稿をガードする用途では、確認を挟まずに自動で処理する（CW を自動で付ける、公開範囲を下げる）方式にします。
:::

## NoteDeck 独自 API

| API | 何をするか |
|---|---|
| `Nd:version` | アプリのバージョン |
| `Nd:call(id, params)` | capability を呼ぶ。権限の範囲内でのみ成功する。確認ダイアログをキャンセルされた場合はエラーにならず、`Core:type` が `"error"` の値が返る |
| `Nd:capabilities()` | 呼べる capability の一覧 |
| `Nd:http(url, options)` | 外部への HTTP リクエスト |
| `Nd:on(event, handler)` | アプリ内のイベントを購読する |
| `Nd:register_command(...)` | コマンドパレットにコマンドを足す |

`Nd:on` で購読できるイベントには、ノートの到着、通知の到着、アカウントの切り替え、カラムの増減、ストリーミングの接続状態、メモの作成・更新・削除、スキルの編集、テーマの適用があります。

## Misskey 互換 API

`Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize` が使えます。Misskey 本体のプラグインをそのまま持ち込む場合は、この範囲で書かれているかを確認してください。

## 権限

外部通信やノートの投稿など、影響のある操作には権限が要ります。メタヘッダの `permissions` に宣言し、導入時にユーザーが承認します。宣言していない操作は実行時に拒否されます。

## 作る・配る

AI カラムで「〇〇するプラグインを作って」と頼むのが最短です。手で書く場合は設定フォルダに置きます。作ったものは [MisStore](https://store.notedeck.io) で配布できます（[提出のしかた](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [書式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)）。
