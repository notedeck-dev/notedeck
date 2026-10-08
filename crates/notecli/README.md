# notecli

Misskey をヘッドレスで操作する Rust ライブラリ & CLI デーモン。

GUI なしで Misskey の主要機能（タイムライン取得、投稿、リアクション、ストリーミング等）を CLI または REST API 経由で利用できます。[NoteDeck](https://github.com/notedeck-dev/notedeck) の Rust バックエンドとしても利用されています。

## インストール

### GitHub Releases（ビルド済みバイナリ）

NoteDeck と同じタグの [Releases](https://github.com/notedeck-dev/notedeck/releases) に、プラットフォームごとのバイナリが `notecli-<version>-<platform>` の名前で載っています（`<version>` はリリースのバージョン。例: `notecli-1.66.0-linux-amd64`）。

| ファイル名 | 対象 |
|-----------|------|
| `notecli-<version>-linux-amd64` | Linux x86_64 |
| `notecli-<version>-linux-arm64` | Linux aarch64 |
| `notecli-<version>-darwin-arm64` | macOS Apple Silicon |
| `notecli-<version>-windows-amd64.exe` | Windows x86_64 |

```sh
# 例: Linux x86_64 の最新版を GitHub CLI で取得
gh release download --repo notedeck-dev/notedeck --pattern 'notecli-*-linux-amd64' --output notecli
chmod +x notecli
sudo mv notecli /usr/local/bin/
```

配布バイナリは OS キーチェーン非対応（`--no-default-features`）でビルドされていて、トークンはローカル DB に保存されます。

### Cargo（ソースからビルド）

```sh
cargo install --git https://github.com/notedeck-dev/notedeck notecli
```

## 使いかた

```sh
# 1. アカウント登録（ブラウザで MiAuth 認証）
notecli login misskey.io

# 2. タイムラインを見る
notecli timeline

# 3. ノートを投稿
notecli post "Hello from notecli!"
```

## CLI

全コマンド・オプションは `notecli --help` で確認できます。各サブコマンドにも `--help` があります。

```sh
notecli --help            # コマンド一覧・出力形式・使用例
notecli post --help       # サブコマンドの詳細
```

## HTTP API

notecli 単体では HTTP の面を出しません (以前の `daemon` サブコマンドは撤去しました。
後継の常駐コア notecored も NoteDeck の #1106 で削除済みです)。同じ REST + SSE の面は
NoteDeck 本体の起動中に使えます。ルート定義はこのクレートのライブラリ側
(`http_server::build_core_routes`) にあり、NoteDeck の HTTP サーバーが取り込んでいます。

## ライブラリとして使う

```toml
[dependencies]
notecli = { git = "https://github.com/notedeck-dev/notedeck" }
```

```rust
use notecli::streaming::FrontendEmitter;

// FrontendEmitter を実装すればストリーミングイベントを任意の宛先に転送可能
struct MyEmitter;
impl FrontendEmitter for MyEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        println!("[{event}] {payload}");
    }
}
```

モジュール構成は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。

## 認証

起動ごとにランダムトークンを生成し `{data_dir}/api-token` に書き出します（Unix: 0600）。
`/api` と `/api/accounts` 以外の全リクエストに `Authorization: Bearer {token}` ヘッダーが必要です。

アカウントの API トークンは OS のキーチェーン（Linux: Secret Service、macOS: Keychain、Windows: Credential Manager）に保存されます。
Linux で Secret Service が使えない環境（サーバー / WSL2 / コンテナ）では、暗号化ファイル `{data_dir}/notecli/secrets.enc` に保存されます（鍵は `{config_dir}/notecli/secret.key`、どちらも 0600）。

## License

MIT
