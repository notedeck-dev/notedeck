# 設定ファイル

NoteDeck の設定はすべてファイルとして手元にあります。UI から変更できるものは、そのままファイルにも書き出されます。外部エディタで直接編集しても構いません。

形式は **JSON5** です。コメントを書けて、末尾のカンマも許されます。

## 設定はどこにあるか

**ファイル → 設定フォルダを開く** でエクスプローラー / Finder が開きます。これが確実です。

パスを知りたい場合は、OS のアプリケーションデータ領域の下です。

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

同じメニューから、ログフォルダ・ダウンロードフォルダ・バックアップフォルダも開けます。

## 何がどこに書かれるか

| ファイル | 中身 |
|---|---|
| `settings.json5` | テーマの選択、モード、ミュート、キャッシュ設定など、単純な値の集約先 |
| `keybinds.json5` | [キーバインド](/docs/guide/keyboard)の上書き |
| `navbar.json5` | [ナビバー](/docs/deck/navbar)のボタン構成 |
| `performance.json5` | 描画まわりの調整値 |
| `postform.json5` | 投稿フォームの設定 |
| `ai.json5` | [AI](/docs/guide/ai) の接続とモデルの選択 |
| `AI.md` | AI に渡す指示書 |
| `tasks.json5` | タスクカラムの内容 |
| `permissions.json5` | プラグインや AI に許可する操作 |
| `custom.css` | [見た目の上書き](/docs/guide/appearance#css-で細かく変える) |

フォルダとして持つものもあります。

`profiles/` `themes/` `plugins/` `widgets/` `skills/` `queries/` `snippets/` `memos/` `sessions/`

`memos/` は Markdown ファイルがそのまま入っているので、Obsidian の vault として開けます。

::: tip API キーはここにありません
アクセストークンや AI の API キーは OS のキーチェーンに入っています。設定フォルダをそのまま誰かに渡しても、鍵は含まれません。
:::

## アプリの中から編集する

外部エディタを使わなくても、設定エディタのウィンドウから編集できます。`settings.json5` は Raw JSON エディタで直接触ることもできます。

変更は基本的に**再起動なしで反映**されます。外部エディタで書き換えた場合も、次に使われるタイミングで読み直されます。

## 書き間違えたとき

JSON5 として壊れているファイルは読み込みに失敗します。その場合、そのファイルの設定は既定値で動きます。おかしいと思ったら、該当ファイルを一度削除してください（既定値で作り直されます）。
