# プラグイン

プラグインは AiScript で書く拡張です。ノートやユーザーに操作を足したり、投稿する内容を書き換えたり、コマンドパレットにコマンドを生やしたりできます。Misskey 本体のプラグインと同じ考え方ですが、NoteDeck 独自の API が加わります。

## 最小構成

先頭に AiScript のバージョンとメタヘッダを書きます。バージョンの行は必須で、無いとプラグインは起動せず、ログに `version header required` と出ます。実行は常に新しい方のインタプリタです。

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

メタで必須なのは `name` と `version` だけです。`config` を書くと、その値が `Plugin:config` で読めます。

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

コマンドパレットのコマンドは、フックではなく後述の `Nd:register_command` で足します。

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
| `Plugin:open_url(url)` | URL を既定のブラウザで開く |

`Nd:on` で購読できるイベントは、ノートの到着、通知の到着、カラムの増減、ストリーミングの接続状態、メモの作成・更新・削除、スキルの編集、テーマの適用です。

`Nd:register_command` で足したコマンドは、コマンドパレット・キーバインド・AI のツール・ローカル API のどこからでも呼べます。AI やローカル API から呼ばれたときの実効権限は「呼び出し元の権限 ∩ プラグインの権限」です。

## Misskey 互換 API

`Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize` が使えます。Misskey 本体のプラグインをそのまま持ち込む場合は、この範囲で書かれているかを確認してください。`Mk:save` の値はファイルではなくアプリ内の保存領域に入り、[バックアップ](/docs/config/backup)には含まれません。

## 権限

プラグインができることは、[権限設定](/docs/guide/ai#権限)の「プラグイン」の行で決まります。既定は読み取り中心の安全な範囲と外部への通信で、投稿などの書き込みは個別に許可します。`Nd:call` / `Nd:http` / `Mk:api` はいずれもこの設定で判定され、拒否された操作はプラグインカラムに拒否のバッジとして出ます。スキルの書き込みや AI への指示にあたる操作は、設定に関わらず常に拒否されます。

メタヘッダの `permissions` は、ストアから更新したときに「新しく要求する権限」を示して再同意を取るための宣言です。

## 保存場所

設定フォルダの `plugins/` に、コード本体 `<slug>.is` とメタ情報 `<slug>.meta.json5` の 2 ファイルで保存されます。一覧はメタファイルから作られるので、`.is` だけを置いても読まれません。手で置くときは、開発者モードのエディタで新規作成してから中身を差し替えるのが確実です。ファイル名は表示名から作った slug（ストア由来なら storeId）で、参照はファイルの中の id で行われます。同じ id が重複すると後のものは読み飛ばされ、トーストで知らされます。

## 作る・配る

AI カラムで「〇〇するプラグインを作って」と頼むのが最短です（先に MisStore の作者スキルを入れておきます）。作成と編集の入口は[開発者モード](/docs/#開発者モード)で開放されます。作ったものは [MisStore](https://store.notedeck.io) で配布できます（[提出のしかた](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [書式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)）。
