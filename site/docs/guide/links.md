# リンクで開く（notedeck://）

デスクトップ版の NoteDeck は、インストール時に `notedeck://` という URL を OS に登録します。ブラウザやランチャー、メモアプリ、スクリプトからこの URL を開くと、起動中の NoteDeck が前面に出てその画面を開きます。

ランチャーのショートカット、毎朝開くカラムのブックマーク、外部ツールからの投稿フォーム呼び出しなどに使えます。

## 送信は確定しない

`notedeck://` は誰でも作れる URL で、Web ページに埋め込んで踏ませることもできます。そのため、リンクから投稿や AI への送信は起きません。

- 投稿フォームと AI カラムは、本文を入れた状態で開くだけで、送信は自分で押します
- ストアからのインストールは、名前と作者 (プラグインなら要求する機能も) を確認ダイアログで見せ、承認したときだけ入ります。入れられるのは MisStore に掲載されているものだけです
- 見つからないプロファイル・カラム・ストアのアイテムを指したリンクは何もしません

## アプリ全体の操作

アカウントを選ばない操作です。値は URL エンコードします（空白は `%20`、改行は `%0A`）。

| URL | 何が起きるか |
|---|---|
| `notedeck://compose?text=<本文>&cw=<注釈>&visibility=<公開範囲>` | 投稿フォームを本文・注釈・公開範囲を入れた状態で開く。どれも省略可。公開範囲は `public` `home` `followers` `specified` のどれか |
| `notedeck://ai?prompt=<文>` | AI カラムを開き、入力欄に文を入れる。AI カラムが無ければ足す |
| `notedeck://memo/new?text=<本文>` | 本文つきのメモを 1 件作る |
| `notedeck://profile/<名前>` | デッキの[プロファイル](/docs/deck/profiles)を切り替える。名前が一致しなければ id として探す |
| `notedeck://column/<id>` | そのカラムをアクティブにする |
| `notedeck://install-plugin?id=<id>` | [MisStore](/docs/guide/store) のプラグインを確認のうえ入れる |
| `notedeck://install-theme?id=<id>` | MisStore のテーマを確認のうえ入れる |

カラムの id は設定フォルダの `profiles/` にあるプロファイルのファイルに書かれています。

## アカウントの画面を開く

`notedeck://<サーバー>/...` の形で、そのサーバーの画面を開きます。`<サーバー>` は `misskey.io` のようなホスト名で、そのサーバーのアカウントでログインしている必要があります。

### カラムを足す

| URL | 足されるカラム |
|---|---|
| `notedeck://<サーバー>/timeline/<種類>` | タイムライン。種類は `home` `local` `social` `global`（省略時は `home`） |
| `notedeck://<サーバー>/notifications` | 通知 |
| `notedeck://<サーバー>/search?q=<検索語>` | サーバー検索 |
| `notedeck://<サーバー>/antenna/<id>` | アンテナ |
| `notedeck://<サーバー>/channel/<id>` | チャンネル |
| `notedeck://<サーバー>/favorites` | お気に入り |
| `notedeck://<サーバー>/mentions` | メンション |
| `notedeck://<サーバー>/direct` | ダイレクト |
| `notedeck://<サーバー>/chat` | チャット |
| `notedeck://<サーバー>/announcements` | お知らせ |
| `notedeck://<サーバー>/drive` | ドライブ |
| `notedeck://<サーバー>/gallery` | ギャラリー |

### ウィンドウを開く

| URL | 開くウィンドウ |
|---|---|
| `notedeck://<サーバー>/note/<id>` | ノート |
| `notedeck://<サーバー>/user/<id>` | ユーザー |
| `notedeck://<サーバー>/user/<id>/following` | フォロー一覧 |
| `notedeck://<サーバー>/user/<id>/followers` | フォロワー一覧 |
| `notedeck://<サーバー>/list/<id>` | リスト |
| `notedeck://<サーバー>/clip/<id>` | クリップ |
| `notedeck://<サーバー>/gallery/<id>` | ギャラリーの投稿 |
| `notedeck://<サーバー>/page/<id>` | ページ |
| `notedeck://<サーバー>/play/<id>` | Play |
| `notedeck://<サーバー>/instance/<ホスト名>` | 連合先サーバーの情報 |

id はそのサーバーの内部 id です（ユーザーなら `@name` ではなく、Raw JSON などで見える `id`）。

## URL の調べ方

デスクトップ版のタイトルバーには、アクティブなカラムやウィンドウの URL が表示されています。よく開く画面は、そこから URL を写してブックマークやランチャーに登録できます。

カラムの URL を開くと、同じ種類のカラムがもう 1 本足されます。デッキにあるカラムへ移るだけなら `notedeck://column/<id>` を使います。
