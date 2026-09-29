# 常駐コア (notecored)

NoteDeck の「コア」は、Misskey との通信・データの保存・AI を担う部分です。既定ではアプリに埋め込まれていて、アプリと一緒に起動して終了します。**notecored** は同じコアを systemd の user サービスとして常駐させるもので、アプリを閉じても HEARTBEAT が止まりません。

::: info notecored は notemaid に置き換わります
今後、常駐するのは AI (エージェントループ / HEARTBEAT / 結果の配送) だけになり、名前は **notemaid** です。AI はアプリが自動で起動する別プロセスとして設定なしで動き、「アプリを閉じても動かす」と「自分のサーバーに置く」は任意になります。データはこれまでどおり端末の上にあり、コアの切り替えと secret の移行はなくなります。このページは現行版の notecored の説明です ([#1106](https://github.com/notedeck-dev/notedeck/issues/1106))。
:::

::: warning 対象は Linux のみ
同じデバイスの常駐 (この段階) は Linux (systemd の user セッションがある環境) だけです。macOS / Windows と、別デバイスの notecored への接続は今後の段階で扱います。Android / iOS はアプリ外のプロセスを常駐させられないため、将来はデスクトップやサーバーの notecored に繋ぐ形になります。
:::

## 何が変わるか

- **常駐するのは AI だけ**です。エージェントループと HEARTBEAT が notecored で走り、アプリは AI 系の呼び出しをそこへ中継します。タイムラインの取得・蓄積・購読・デッキはこれまでどおりアプリの中で動き、notecored はそれらを持ちません
- **データは同じ場所**です。notecored はアプリと同じデータディレクトリを使い、アカウントの資格情報とキャッシュを読みます。引っ越しはありません
- **版はアプリと一致している必要があります**。違う版の notecored には繋がりません (状態面に理由が出ます)

## インストール

アプリと同じ版を入れてください。

::: code-group

```bash [AUR (Arch Linux)]
yay -S notecored-bin
```

```bash [Nix (profile)]
nix profile add 'github:notedeck-dev/notedeck#notecored'
```

```nix [home-manager]
# flake の inputs に notedeck を足したうえで
imports = [ notedeck.homeManagerModules.notecored ];
services.notecored.enable = true;
```

```bash [deb / tarball]
# アプリの .deb と tarball には同版の notecored が同梱されています
notecored --version
```

:::

AppImage を使っている場合は、Releases にある standalone のバイナリ (`notecored-<version>-linux-amd64` など) を PATH の通った場所に置いてください。

## 切り替える

切り替えは今のところ手動です (アプリが子プロセスとして自動で起動する形と、設定のトグルは今後の段階)。

1. `notecored service enable` で user サービスを有効にします
2. 設定フォルダ (「ファイル → 設定フォルダを開く」) の `client.json5` を `{ backend: "resident" }` にします
3. アプリを再起動します。設定メニューの**コア**に接続状態が出て、ナビバーの上部にサーバーの印が出ます

戻すときは `client.json5` を `{ backend: "embedded" }` にして再起動し、`notecored service stop` (不要なら `uninstall`) です。

## 前提

- systemd の **user セッション**が動いていること (`systemctl --user status` が通る)。WSL2 では `/etc/wsl.conf` で systemd を有効にします
- `XDG_RUNTIME_DIR` が設定されていること (socket の置き場)
- ログアウト後も動かし続けたいときは `loginctl enable-linger` を設定します (アプリは自動では設定しません)

## 困ったとき

- **ログ**: `journalctl --user -u notecored -e` (「コア」のボタンでコマンドをコピーできます)。journal が無い環境ではデータディレクトリの `logs/notecored.log` に出ます
- **版が違う**: notecored をアプリと同じ版に更新してから切り替えてください
- **notecored が自分で止まる**: 再起動しても直らない状態 (別のプロセスがデータディレクトリを使っている、データベースが notecored より新しい、runtime dir が無い、secret の鍵が読めない) では専用の終了コードで止まり、systemd は再起動しません。`journalctl` に理由が出ます

## コマンド

```bash
notecored run                 # 前面で常駐 (アプリと同じデータディレクトリ。アプリは閉じてから)
notecored status              # 動いている notecored の状態
notecored service install     # user unit を用意する (enable / start はしない)
notecored service enable      # enable + start
notecored service status | stop | restart | uninstall
```

アプリ側の `client.json5` が `embedded` のままなら、notecored が動いていてもアプリは AI をアプリの中で回します (両方が同じデータディレクトリを読むだけで衝突はしません)。
