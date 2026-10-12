# AI の別プロセス (notemaid)

NoteDeck の AI (エージェントループと HEARTBEAT) は、アプリとは別のプロセス **notemaid** で動きます。タイムラインの取得・蓄積・購読・デッキはアプリの中で動き、notemaid は AI だけを持ちます。ふだんは意識する必要はありません。アプリが起動時に同梱の notemaid を子プロセスとして立ち上げ、終了時に一緒に終わります。

## 2 つの動かし方

| 形 | 誰が起動するか | 何ができるか |
|---|---|---|
| 既定 (子プロセス) | アプリ | 設定なし。アプリと一緒に始まり、一緒に終わる。ウィンドウを閉じてトレイに残していれば AI も生きている |
| 常駐 | OS のログイン時タスク (エージェント設定のトグル) | アプリを完全に終了しても HEARTBEAT が続く。次にアプリを開くと自動でそちらに繋がり、閉じている間の報告はアプリの通知にまとめて届く |

どちらも同じ端末の上で動きます。別の端末や自分のサーバーで動く notemaid に繋ぐ形は用意していません (得られるのが巡回の継続だけで常駐と同じなのに対し、認証や鍵の置き場の面倒が大きいため)。

アプリは起動時にまず常駐の notemaid が居るかを見て、居れば繋ぎ、居なければ子プロセスを起動します。同梱の notemaid が無い、または起動に失敗したときはアプリの中で動かします (**NoteDeck について**の自己診断に「アプリの中で実行しています」と理由が出ます)。どの形でもデータ (蓄積・購読・デッキ) は端末の上にあり、notemaid はアプリの設定と、OS のキーチェーンにある同じアカウントのトークンを使います (アプリのデータベースは開きません)。版はアプリと一致している必要があります (違えば自己診断に理由が出ます)。

## 常駐にする

アプリを完全に閉じても HEARTBEAT を回したいときだけ設定します。設定メニューの**エージェント** → HEARTBEAT にある「アプリを終了しても続ける」をオンにすると (トレイメニューの「アプリを終了しても AI を動かす」も同じトグルです)、OS のログイン時タスク (Linux は systemd の user unit、macOS は LaunchAgent、Windows はユーザーごとの Run キー (ログイン時の自動起動)) に登録され、その場で切り替わります (再起動不要)。オフに戻すと登録を外し、子プロセスに戻ります。

常駐で得られるのは、巡回が止まらないことです。報告の置き場所は HEARTBEAT のセッションで、閉じている間に届いた報告は、次にアプリを開いたときにアプリの通知へ「閉じている間の報告」として 1 件にまとめて出ます (確認待ちの操作があれば一緒に)。閉じている間に OS の通知は出ません。

AppImage は起動のたびにマウント先が変わるので、トグルは使えません。Releases の standalone バイナリ (`notemaid-<版>-linux-amd64` など。アプリと同じ版を選び、`notemaid` に改名して実行権限を付ける) を PATH の通った場所に置き、手で登録します。Nix で入れた notemaid も同じで、`--exec-path` で場所を渡すか、flake の home-manager モジュールを使います。

```bash
notemaid service install                      # ログイン時タスクを用意する
notemaid service install --exec-path /path/to/notemaid   # PATH に無い場所に置いたとき
notemaid service enable                       # 登録して起動
```

Linux でログアウト後も動かし続けるには `loginctl enable-linger` を設定します。止めるときは `notemaid service stop`、不要なら `uninstall` です。

常駐にだけ繋ぎたい (子プロセスを起動してほしくない) ときは、設定フォルダの `client.json5` を `{ backend: "resident" }` にします。ログイン時タスクが登録されていなければ `auto` に戻して子プロセスで動きます。逆に常にアプリの中で回したい (開発や切り分け) ときは `{ backend: "embedded" }` です。既定は `auto` です。このファイルは端末ごとのもので、[バックアップ](/docs/config/backup)には入りません。

## 前提

- Linux の常駐は systemd の **user セッション**が動いていること (`systemctl --user status` が通る)。WSL2 では `/etc/wsl.conf` で systemd を有効にします
- 常駐の socket の置き場に `XDG_RUNTIME_DIR` が要ります。無いと常駐は専用の終了コードで止まります。子プロセスは無くても動きます (一時ディレクトリを使います)

## 困ったとき

- **ログ**: 子プロセスと macOS / Windows の常駐はアプリデータフォルダの `logs/notemaid.log.<日付>` (日ごとに分かれます)、Linux の常駐は `journalctl --user -u notemaid -e`
- **版が違う**: notemaid をアプリと同じ版に更新してください。子プロセスは同梱なので常に同じ版です
- **notemaid が自分で止まる**: 再起動しても直らない状態 (別の notemaid が同じデータディレクトリで動いている、`XDG_RUNTIME_DIR` が無い、secret の鍵が読めない) では専用の終了コードで止まり、systemd は再起動しません。理由はログに出ます

## notemaid の持ち物

notemaid が書くのは設定フォルダの中の自分の持ち物だけです: AI の人格と記憶 (`notemaid/`)、AI セッション (`sessions/`)、メモ (`memos/`)、スキル (`skills/`)、AI 設定 (`ai.json5`)。アプリのデータベースは開きません。アプリから写されたアカウントの一覧 (`notemaid-accounts.json`、トークンは含まない) はアプリデータフォルダに置きます。Linux で Secret Service が無い環境では、トークンの退避先として暗号化ファイルと鍵も書きます。

人格と記憶の中身はエージェント設定の「ペルソナ」と「メモリー」で読み書きできます (人格の本文 SOUL.md だけは開発者モードのタブか外部エディタで)。ファイルの一覧は[設定ファイル](/docs/config/files)にあります。

## コマンド

```bash
notemaid                     # サブコマンド省略時は run
notemaid run                 # 前面で動かす (Linux の既定はファイル保管のトークン。アプリと同じキーチェーンを使うなら --secrets keychain)
notemaid status              # 動いている notemaid の状態
notemaid mcp                 # stdio の MCP サーバーとして、起動中の NoteDeck へ転送する (AI と使う → MCP)
notemaid service install     # ログイン時タスクを用意する (start はしない)
notemaid service enable      # 登録して起動
notemaid service start | status | stop | restart | uninstall
```
