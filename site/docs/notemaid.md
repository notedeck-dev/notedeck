# AI の別プロセス (notemaid)

NoteDeck の AI (エージェントループと HEARTBEAT) は、アプリとは別のプロセス **notemaid** で動きます。タイムラインの取得・蓄積・購読・デッキはアプリの中で動き、notemaid は AI だけを持ちます。ふだんは意識する必要はありません。アプリが起動時に同梱の notemaid を子プロセスとして立ち上げ、終了時に一緒に終わります。

## 3 つの動かし方

| 形 | 誰が起動するか | 何ができるか |
|---|---|---|
| 既定 (子プロセス) | アプリ | 設定なし。アプリと一緒に始まり、一緒に終わる。ウィンドウを閉じてトレイに残していれば AI も生きている |
| 常駐 | OS のログイン時タスク (AI 設定のトグル) | アプリを完全に終了しても HEARTBEAT が続く。次にアプリを開くと自動でそちらに繋がる |
| 自分のサーバー | サーバー側で起動 | 端末の電源と無関係に AI が動く (外向きの接続は今後の段階) |

アプリは起動時にまず常駐の notemaid が居るかを見て、居れば繋ぎ、居なければ子プロセスを起動します。どの形でもデータ (蓄積・購読・デッキ) は端末の上にあり、notemaid はアプリの設定と、OS のキーチェーンにある同じアカウントのトークンを使います (アプリのデータベースは開きません)。版はアプリと一致している必要があります (違えば AI 設定に理由が出ます)。

## 常駐にする

アプリを完全に閉じても HEARTBEAT を回したいときだけ設定します。設定メニューの **AI 設定** → HEARTBEAT にある「アプリを終了しても続ける」をオンにすると、OS のログイン時タスク (Linux は systemd の user unit、macOS は LaunchAgent、Windows はタスク スケジューラ) に登録され、その場で切り替わります (再起動不要)。オフに戻すと登録を外し、子プロセスに戻ります。

AppImage は起動のたびにマウント先が変わるので、トグルは使えません。Releases の standalone バイナリを PATH の通った場所に置き、手で登録します。

```bash
notemaid service install    # ログイン時タスクを用意する
notemaid service enable     # 登録して起動
```

Linux でログアウト後も動かし続けるには `loginctl enable-linger` を設定します。止めるときは `notemaid service stop`、不要なら `uninstall` です。

常駐にだけ繋ぎたい (子プロセスを起動してほしくない) ときは、設定フォルダの `client.json5` を `{ backend: "resident" }` にします。逆に常に in-process で回したい (開発や切り分け) ときは `{ backend: "embedded" }` です。既定は `auto` です。

## 前提

- Linux の常駐は systemd の **user セッション**が動いていること (`systemctl --user status` が通る)。WSL2 では `/etc/wsl.conf` で systemd を有効にします
- 常駐の socket の置き場に `XDG_RUNTIME_DIR` が要ります。子プロセスは無くても動きます (一時ディレクトリを使います)

## 困ったとき

- **ログ**: 子プロセスと macOS / Windows の常駐はデータディレクトリの `logs/notemaid.log`、Linux の常駐は `journalctl --user -u notemaid -e` (AI 設定のボタンでコマンドをコピーできます)
- **版が違う**: notemaid をアプリと同じ版に更新してください。子プロセスは同梱なので常に同じ版です
- **notemaid が自分で止まる**: 再起動しても直らない状態 (別の notemaid が同じデータディレクトリで動いている、secret の鍵が読めない) では専用の終了コードで止まり、systemd は再起動しません。理由はログに出ます

## コマンド

```bash
notemaid run                 # 前面で動かす
notemaid status              # 動いている notemaid の状態
notemaid service install     # ログイン時タスクを用意する (start はしない)
notemaid service enable      # 登録して起動
notemaid service status | stop | restart | uninstall
```
