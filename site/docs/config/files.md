# 設定ファイル

NoteDeck の設定はすべてファイルとして手元にあります。UI から変更できるものは、そのままファイルにも書き出されます。外部エディタで直接編集しても構いません。

形式は **JSON5** です。コメントを書けて、末尾のカンマも許されます。

例外として、今開いているプロファイル、ウィジェットの配置、プラグインやウィジェットが `Mk:save` で残した値は、ファイルではなくアプリ内の保存領域にあります。

## 設定はどこにあるか

**ファイル → 設定フォルダを開く** でエクスプローラー / Finder が開きます。これが確実です。

パスを知りたい場合は、OS のアプリケーションデータ領域の下です。

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

ひとつ上の `com.notedeck.desktop/` がアプリデータフォルダで、ノートのキャッシュ `notecli.db`、ログ、AI の別プロセスがアプリから写したアカウント一覧 (`notemaid-accounts.json`) はそこにあります。環境変数 `NOTEDECK_APP_DIR` でアプリデータフォルダの場所を変えられます。

同じメニューから、ログフォルダ・ダウンロードフォルダ・バックアップフォルダも開けます。

## 何がどこに書かれるか

| ファイル | 中身 |
|---|---|
| `settings.json5` | テーマの選択、モード、ミュート、キャッシュ設定など、単純な値の集約先 |
| `keybinds.json5` | [キーバインド](/docs/guide/keyboard)の上書き |
| `navbar.json5` | [ナビバー](/docs/deck/navbar)のボタン構成 |
| `performance.json5` | 描画まわりの調整値 |
| `postform.json5` | 投稿フォームの設定 |
| `ai.json5` | [AI](/docs/guide/ai) の接続とモデルの選択、HEARTBEAT の設定 |
| `tasks.json5` | タスクカラムで実行するタスクの宣言 |
| `permissions.json5` | プラグインや AI に許可する操作。壊れていると、すべての行を読み取りのみとして起動する |
| `locale.json5` | 表示言語 |
| `tutorial.json5` | チュートリアルの達成記録と実績 |
| `custom.css` | [見た目の上書き](/docs/guide/appearance#css-で細かく変える)（履歴は `custom.css.history.json5`） |
| `theme-dropins.json5` | `themes/` に手で置いたテーマの取り込み記録 |
| `client.json5` | この端末だけの構成（[AI の別プロセス](/docs/notemaid)の繋ぎ方など）。バックアップには入らない |

フォルダとして持つものもあります。

| フォルダ | 中身 |
|---|---|
| `profiles/` | デッキのプロファイル (`*.ndprofile.json5`) |
| `themes/` | テーマ (`*.ndtheme.json5`) |
| `plugins/` `widgets/` `queries/` | コード本体 `*.is` とメタ情報 `*.meta.json5` の組 |
| `skills/` | スキル (`*.md`)。`AGENTS.md` と `HEARTBEAT.md` は予約 |
| `snippets/` | スクラッチパッドのスニペット |
| `memos/` | メモ (`*.md`) |
| `sessions/` | AI の会話。自分だけが読める権限で保存される |
| `notemaid/` | AI の人格と記憶 |

ファイル名は表示名から作った slug（ストア由来なら storeId）で、参照はファイルの中の id で行われます。同じ id を持つファイルが重複すると後のものは読み飛ばされ、トーストで知らされます。

`memos/` は Markdown ファイルがそのまま入っているので、Obsidian の vault として開けます。

`notemaid/` は AI の人格と記憶です。`SOUL.md` (人格) / `USER.md` (あなたについて覚えていること) / `MEMORY.md` (覚え書き) の 3 つの Markdown と、初回だけの `BOOTSTRAP.md`。外部エディタで直接書き換えても次の会話から効きます (AI には「NoteDeck の外で変更された」と伝わります)。エージェント設定の「ペルソナ」「メモリー」からも読み書きでき、`SOUL.md` の本文だけは開発者モードのタブか外部エディタで編集します。`skills/` の `AGENTS.md` (ルール) と `HEARTBEAT.md` (巡回の手順) は名前と役割が固定で、消したり改名したりできず、スキルカラムには出ません (エージェント設定から編集します)。バックアップに入るのは 3 つの Markdown だけです。

::: tip API キーはここにありません
アクセストークンや AI の API キーは OS のキーチェーンに入っています（Linux で Secret Service が無い環境では暗号化ファイルに退避します）。設定フォルダをそのまま誰かに渡しても、鍵は含まれません。
:::

## アプリの中から編集する

外部エディタを使わなくても、設定エディタのウィンドウから編集できます。[開発者モード](/docs/#開発者モード)では、`settings.json5` などを生のまま編集するタブも出ます。

変更は基本的に**再起動なしで反映**されます。外部エディタで書き換えた場合も、次に使われるタイミングで読み直されます。

## 書き間違えたとき

JSON5 として壊れているファイルは読み込みに失敗します。その場合、そのファイルの設定は既定値で動きます（`permissions.json5` だけは安全側に倒れ、すべての行が読み取りのみになります）。おかしいと思ったら、該当ファイルを一度削除してください（既定値で作り直されます）。
