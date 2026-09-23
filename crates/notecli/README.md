# notecli

Misskey をヘッドレスで操作する Rust ライブラリ & CLI デーモン。

GUI なしで Misskey の主要機能（タイムライン取得、投稿、リアクション、ストリーミング等）を CLI または REST API 経由で利用できます。[NoteDeck](https://github.com/notedeck-dev/notedeck) の Rust バックエンドとしても利用されています。

## インストール

### GitHub Releases（ビルド済みバイナリ）

[Releases](https://github.com/notedeck-dev/notecli/releases) からプラットフォームに合ったバイナリをダウンロードできます。

| ファイル名 | 対象 |
|-----------|------|
| `notecli-linux-amd64` | Linux x86_64 |
| `notecli-linux-arm64` | Linux aarch64 |
| `notecli-darwin-amd64` | macOS Intel |
| `notecli-darwin-arm64` | macOS Apple Silicon |
| `notecli-windows-amd64.exe` | Windows x86_64 |

```sh
# 例: Linux x86_64
curl -Lo notecli https://github.com/notedeck-dev/notecli/releases/latest/download/notecli-linux-amd64
chmod +x notecli
sudo mv notecli /usr/local/bin/
```

### Nix Flake

```sh
# そのまま実行
nix run github:notedeck-dev/notecli

# プロファイルにインストール
nix profile install github:notedeck-dev/notecli
```

### Cargo（ソースからビルド）

```sh
cargo install --git https://github.com/notedeck-dev/notecli.git
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

デーモン起動後、`localhost:19820` で REST API を提供します。

```sh
TOKEN=$(cat ~/.local/share/notecli/api-token)

# エンドポイント一覧（認証不要）
curl http://localhost:19820/api

# アカウント一覧（認証不要）
curl http://localhost:19820/api/accounts

# タイムライン
curl -H "Authorization: Bearer $TOKEN" http://localhost:19820/api/{host}/timeline/home

# ノート投稿
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "Hello from notecli!"}' \
  http://localhost:19820/api/{host}/note

# SSE イベントストリーム
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:19820/api/events
```

全エンドポイントは `/api` で確認できます（認証不要）:

```sh
curl http://localhost:19820/api
```

## ライブラリとして使う

```toml
[dependencies]
notecli = { git = "https://github.com/notedeck-dev/notecli.git" }
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

## License

MIT
