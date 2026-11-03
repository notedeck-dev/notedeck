# 他のアプリから使う（Raycast / Stream Deck / Obsidian）

デスクトップ版の NoteDeck は、起動中ずっと手元の HTTP API（`127.0.0.1:19820`）を開いていて、インストール時に `notedeck://` リンクを OS に登録しています。この 2 つを使うと、他のアプリから NoteDeck を操作できます。

公式の連携は 3 つあり、どれも NoteDeck 本体には何も足さず、別のリポジトリで配っています。同じ API を使って自分で書くこともできます。

| 連携 | 向いていること | リポジトリ |
|---|---|---|
| Raycast 拡張 | ランチャーから投稿・検索・カラム移動 | [notedeck-raycast](https://github.com/notedeck-dev/notedeck-raycast) |
| Stream Deck プラグイン | 物理キーで投稿・カラム切替・ボスキー | [notedeck-streamdeck](https://github.com/notedeck-dev/notedeck-streamdeck) |
| Obsidian プラグイン | ノートを vault に取り込む、Obsidian から投稿、サイドバーのタイムライン | [notedeck-obsidian](https://github.com/notedeck-dev/notedeck-obsidian) |

::: warning まだストアには出していません
3 つとも Raycast Store / Stream Deck Marketplace / Obsidian のコミュニティプラグインには未掲載です。各リポジトリの README にある手順でビルドして入れます。実機での確認も十分ではないので、動かないときは issue で知らせてください。
:::

## 共通の仕組み

3 つの連携は同じ 2 つの入口を使います。どれか 1 つの設定を覚えれば、残りも同じです。

**トークンが要る操作** — NoteDeck の API を呼ぶ操作（投稿、検索、アカウント一覧、タイムラインの取得など）には永続 API トークンが要ります。

1. 設定 → 権限 → 「永続 API トークン」でトークンを発行し、連携の設定に貼ります
2. 連携ごとに別のトークンを発行し、名前（`raycast` `streamdeck` `obsidian` など）を付けておくと、確認ダイアログや操作の記録にその名前が出て、どの連携がやったことか分かります
3. 発行時にそのトークンでできる操作を選びます。既定は読み取りだけで、投稿などの書き込みは個別に許可します。上限は同じ画面の「外部アプリ」の権限で、実際に効くのは両方の交差です
4. 投稿などの書き込みは、必ず NoteDeck の画面で確認してから実行されます。連携側は、あなたが NoteDeck で答えるまで待ちます

**トークンが要らない操作** — 投稿フォームを開く、プロファイルを切り替える、カラムを前面に出す、といった画面の操作は `notedeck://` リンクで行います。トークンも権限も確認も要りません。リンクを開くのはあなた自身だからです。リンクで何ができるかは[リンクで開く](/docs/guide/links)にあります。

::: tip 安全境界ではありません
トークンの権限は、行儀のよい連携の事故を防ぎ、誰が何をしたかを見分けるためのものです。同じ OS ユーザーで動くプログラムは、NoteDeck 本体と同じものに届きます。詳しくは [AI と使う](/docs/guide/ai#外部の-ai-エージェントから使う-mcp) の同じ注意を参照してください。
:::

どの連携も、NoteDeck が同じ端末で起動している間だけ動きます。開発版の NoteDeck（`pnpm tauri:dev`）は API のポートが違うので、連携側の設定で API の URL を変えます。

## Raycast

Raycast（macOS / Windows）のコマンドとして NoteDeck を呼びます。

| コマンド | 何をするか | 要るもの |
|---|---|---|
| Post Note | 本文・アカウント・公開範囲・CW を入れて投稿する。⌘O で NoteDeck の投稿フォームに渡すこともできる | トークン + `notes.write` |
| Open Post Form | NoteDeck の投稿フォームを、本文を入れた状態で開く | なし |
| Search My Notes | 手元に貯まった自分のノートとメモを検索する。空で直近のもの。Enter で NoteDeck の中で開く | トークン + `notes.readArchive` と `memos.read` |
| Jump to Column | デッキのカラムを選んで前面に出す | トークン（読み取りの既定で足りる） |
| Switch Deck Profile | [プロファイル](/docs/deck/profiles)を名前で切り替える | なし |
| Ask AI | AI カラムを、プロンプトを入れた状態で開く。送信は自分で押す | なし |
| New Memo | ローカルのメモを 1 件作る | トークン + `memos.write` |
| Hide NoteDeck / Show NoteDeck | ウィンドウを隠す / 前面に戻す（ボスキー） | トークン（権限は不要） |
| Run Capability | NoteDeck のあらゆる capability（コマンドパレット・プラグイン・AI が使えるものすべて）を一覧から選び、引数を入れて実行する。結果は JSON で見える | トークン + その capability に応じた権限 |

Run Capability は、他の連携で使うアカウント id やカラム id を調べるのにも便利です。

## Stream Deck

Stream Deck のキーに NoteDeck のアクションを割り当てます。API の URL とトークンは最初の 1 つのキーで入れれば、他のキーにも共有されます。

| アクション | 何をするか | 要るもの |
|---|---|---|
| Post Note | あらかじめ決めた本文（アカウント・CW・公開範囲つき）を投稿する | トークン + `notes.write` |
| Open Post Form | NoteDeck の投稿フォームを、決めた本文を入れた状態で開く | なし |
| Run Capability | capability の id と JSON の引数を決めておき、キーで実行する | トークン + その capability に応じた権限 |
| Focus Column | 決めたカラムを前面に出す | なし |
| Switch Deck Profile | 決めたプロファイルに切り替える | なし |
| Hide NoteDeck / Show NoteDeck | ウィンドウを隠す / 前面に戻す（ボスキー） | トークン（権限は不要） |

成功するとキーに ✓、失敗すると ⚠ が出ます。理由はプラグインのログにあります。

## Obsidian

Obsidian（デスクトップ）から Misskey のノートを vault に持ち込み、Obsidian から投稿し、サイドバーでタイムラインを眺めます。

| コマンド / 画面 | 何をするか | 要るもの |
|---|---|---|
| Clip a note by URL | ノートの URL を入れると、そのノートを Markdown（YAML frontmatter つき）として vault に書く | トークン（読み取りの既定で足りる） |
| Search NoteDeck's archive and clip | 手元に貯まったノートをサーバーとアカウントを跨いで検索し、Enter で vault に取り込む。Mod+Enter でカーソル位置にリンクを挿す | トークン + `notes.readArchive` |
| Post a note | 選択範囲を本文にして投稿する（アカウント・公開範囲・CW を選べる） | トークン + `notes.write` |
| Open NoteDeck's post form with selection | 選択範囲を NoteDeck の投稿フォームに渡す | なし |
| タイムライン（サイドバー） | アカウントを選んで home / local / social / global を表示する。新しいノートは NoteDeck のイベントストリームから届く。ノートを押すと取り込み・NoteDeck で開く・サーバーで開く・リンクをコピー | トークン（読み取りの既定で足りる） |

取り込んだノートは、設定で決めたフォルダ（既定 `NoteDeck/`）に「日時 ハンドル id.md」の名前で置かれ、同じノートをもう一度取り込んでも上書きせず既存のファイルを開きます。frontmatter には投稿者・URL・日時・公開範囲・CW・引用元が入り、本文は MFM のまま、CW は折りたたみの callout、画像は埋め込み、センシティブな画像とそれ以外のファイルはリンクになります。

::: tip メモはプラグインを通さずそのまま開けます
NoteDeck の[メモ](/docs/deck/columns)は設定フォルダの `memos/` に Markdown ファイルとして置かれています。そのフォルダを Obsidian の vault として開けば、プラグインなしで読み書きできます。このプラグインはメモには触れません。
:::

Clip a note by URL が受け付けるのは、NoteDeck でログインしているサーバーのノート URL だけです（そのアカウントでノートを取りに行くため）。他のサーバーのノートは、検索から取り込みます。

## 自分で書く

3 つの連携がやっていることは、`127.0.0.1:19820` に Bearer トークンつきで HTTP を送ることと、`notedeck://` リンクを開くことだけです。同じことはどの言語からでもできます。

- API の一覧は、[開発者モード](/docs/#開発者モード)の「API ドキュメント」カラムで見られます。capability は `POST /api/capabilities/<id>/execute` で呼び、`GET /api/capabilities` にすべての capability とその引数・権限の宣言があります
- 新しいノートや通知をその場で受け取るには `GET /api/events` の Server-Sent Events を購読します
- AI エージェントから使うなら、同じトークンで [MCP](/docs/guide/ai#外部の-ai-エージェントから使う-mcp) に繋ぐ方が早いです

連携を作ったら、issue で知らせてください。このページに並べます。
