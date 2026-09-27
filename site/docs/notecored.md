# 常駐コア (notecored)

NoteDeck の「コア」は、Misskey との通信・データの保存・AI を担う部分です。既定ではアプリに埋め込まれていて、アプリと一緒に起動して終了します。**notecored** は同じコアを systemd の user サービスとして常駐させるもので、アプリを閉じても通知の受信や HEARTBEAT が止まりません。

::: warning 対象は Linux のみ
同じデバイスの常駐 (この段階) は Linux (systemd の user セッションがある環境) だけです。macOS / Windows と、別デバイスの notecored への接続は今後の段階で扱います。Android / iOS はアプリ外のプロセスを常駐させられないため、将来はデスクトップやサーバーの notecored に繋ぐ形になります。
:::

## 何が変わるか

- **データは同じ**です。notecored はアプリと同じデータディレクトリを使い、切り替えはデータの引っ越しではなく「動かし手」の交代です。同時に 2 つのプロセスが同じデータを触らないよう、ロックで守られています
- **secret の置き場が変わります**。アプリは Misskey のトークンと接続の secret を OS のキーチェーンに置きますが、notecored は暗号化ファイルに置きます。切り替えの際に移行パッケージでコピーし、戻すときは取り戻します。保護は OS のキーチェーンより弱くなるので、確認の画面にその旨が出ます
- **版はアプリと一致している必要があります**。違う版の notecored には繋げません。切り替えの前にアプリが照合し、違えば更新を促します

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

1. 設定で**開発者モード**を有効にします (常駐への切り替えは今のところ開発者向けの入口です)
2. 設定メニューの**コア**を開きます。notecored が見つかっていれば、そのパスと版が表示されます
3. **常駐に切り替える**を押し、確認を読んで進めます。secret を書き出した件数と「再起動すると切り替わります」が表示されます
4. アプリを**再起動**します。起動時に secret を取り込み、常駐サービスを有効にして繋ぎます

切り替わると、ナビバーの上部にサーバーの印が出ます。押すと「コア」が開き、接続状態と notecored の稼働状況が見えます。

戻すときも同じ画面の**埋め込みに戻す**から、確認 → 再起動です。secret をこのアプリの保管先に取り戻し、全部戻せたら notecored 側の複製を消します。

## 前提

- systemd の **user セッション**が動いていること (`systemctl --user status` が通る)。WSL2 では `/etc/wsl.conf` で systemd を有効にします
- `XDG_RUNTIME_DIR` が設定されていること (socket と移行パッケージの置き場)
- ログアウト後も動かし続けたいときは `loginctl enable-linger` を設定します (アプリは自動では設定しません)

## 困ったとき

- **ログ**: `journalctl --user -u notecored -e` (「コア」のボタンでコマンドをコピーできます)。journal が無い環境ではデータディレクトリの `logs/notecored.log` に出ます
- **切り替えが完了しない**: 「コア」に理由が出ます。移行パッケージが消えていた (再ログインで一時ディレクトリが消えたなど) 場合は、「もう一度切り替える」か「やめて埋め込みのまま使う」を選べます
- **版が違う**: notecored をアプリと同じ版に更新してから切り替えてください
- **notecored が自分で止まる**: 再起動しても直らない状態 (別のプロセスがデータディレクトリを使っている、データベースが notecored より新しい、runtime dir が無い、secret の鍵が読めない) では専用の終了コードで止まり、systemd は再起動しません。`journalctl` に理由が出ます

## コマンド

```bash
notecored run                 # 前面で常駐 (アプリと同じデータディレクトリ。アプリは閉じてから)
notecored status              # 動いている notecored の状態
notecored service install     # user unit を用意する (enable / start はしない)
notecored service enable      # enable + start
notecored service status | stop | restart | uninstall
notecored migrate status      # secret と移行パッケージの有無
notecored run --api           # 公開 API 面 (localhost の REST + SSE) も出す
```

手で `run` や `service enable` をしても、アプリ側の設定が「埋め込み」のままだとアプリは埋め込みで起動しようとしてロックが衝突します。両方を揃えるのがアプリの切り替えなので、手動は動作確認や `--api` の用途に限るのがよいです。
