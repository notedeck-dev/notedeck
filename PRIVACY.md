# Privacy Policy

NoteDeck は Misskey を中心とした分散型 SNS のためのデスクトップ統合環境 (IDE) です。本ドキュメントは NoteDeck がユーザーデータをどう扱うかを明示します。

## 基本方針

NoteDeck の開発者はサーバーを一切運営していません。ユーザーデータは原則としてローカルマシン上にのみ保存され、外部に送信されるのは以下の場合だけです：

- ユーザーが接続を設定した **Misskey サーバー**
- ユーザーが接続を設定した **AI プロバイダー** (Anthropic / OpenAI / OpenAI 互換 API 等)
- ユーザーが明示的に開いた **外部 URL** (ノートリンク、OGP 取得対象等)
- **アップデートチェック** (GitHub Releases へのリクエストのみ)

開発者は上記のいずれを経由してもユーザーデータを受け取りません。

## OS キーチェーンに格納される機密情報

機密性の高い認証情報は OS のキーチェーンに格納されます。設定ファイルや SQLite データベースには保存されません。

- **Misskey アクセストークン** (各サーバー / 各アカウントごと)
- **AI プロバイダーの API キー** (Secret Vault 経由、接続単位で格納)
- **WebPush 通知用 VAPID キー** (Push 通知有効時のみ)

格納先:

| OS | バックエンド |
|---|---|
| macOS | Keychain Access |
| Linux | Secret Service (gnome-keyring / KWallet 等) |
| Windows | Credential Manager |

## ローカルに保存されるデータ

設定フォルダ (`$APP_DATA_DIR/notedeck/`) 配下に以下が保存されます。「ファイル → 設定フォルダを開く」から場所を確認できます。

| ファイル / フォルダ | 内容 |
|---|---|
| `notecli.db` (SQLite) | ノート・通知・ユーザー情報のキャッシュ、FTS5 全文検索インデックス、チャットキャッシュ |
| `settings.json` | テーマ・キーバインド・カラム構成・AI 設定 (機密以外) |
| `accounts.json5` | 接続中アカウント一覧 (トークン本体はキーチェーン) |
| `profiles/` | デッキプロファイル (カラム配置等) |
| `themes/` | ユーザー作成テーマ |
| `plugins/` | プラグイン本体・設定 |
| `widgets/` | ウィジェット |
| `snippets/` | スニペット |
| `memos/` | AI メモ |
| `sessions/` | AI チャットセッション履歴 |
| `image-cache/` | 表示画像のキャッシュ |

これらはすべてユーザーマシン上に留まり、NoteDeck 開発者がアクセスする手段はありません。

## ネットワーク通信

NoteDeck が行う外部通信は以下に限定されます：

1. **Misskey サーバー** — REST / WebSocket ストリーミング、画像取得
2. **AI プロバイダー** — AI チャット使用時のみ。Anthropic Messages API / OpenAI Chat Completions API 互換
3. **WebPush エンドポイント** — Push 通知有効化時のみ
4. **アップデートチェック** — `https://github.com/hitalin/notedeck/releases/latest` (Tauri Updater)
5. **OGP 取得** — ノート内 URL の OGP 情報取得 (設定で無効化可能)

### NoteDeck が行わない通信

- ❌ テレメトリー / 利用統計の送信
- ❌ クラッシュレポートの自動送信
- ❌ 広告配信
- ❌ サードパーティ analytics (Google Analytics 等)
- ❌ 開発者へのユーザーデータ送信

## AI チャット機能のデータ取り扱い

AI チャット機能を使用すると、入力したメッセージと、ユーザーが capability で許可したコンテキスト情報が、選択した AI プロバイダーに送信されます。

- **送信先**: ユーザーが Vault に登録した AI プロバイダー
- **データ保管**: AI プロバイダーのプライバシーポリシーに従います (NoteDeck 開発者は記録しません)
- **HEARTBEAT デーモン使用時**: 設定された skill の内容に従い、AI プロバイダーへ定期送信されます (デフォルトは無効)
- **AI セッション履歴**: `sessions/` フォルダにローカル保存されます

## データの削除

- **アカウント単位**: アカウントメニュー → ログアウト → 「すべて削除」でキャッシュ・トークン・関連データを削除
- **完全削除**: 設定フォルダを丸ごと削除
- **アンインストール**: OS のアプリ削除手順に従う (設定フォルダはユーザー判断で別途削除)

## 第三者への提供

NoteDeck 開発者は、ユーザーデータを第三者に提供しません。そもそも開発者の手元にユーザーデータは存在しません。

## オープンソース

NoteDeck は AGPL-3.0 ライセンスで公開されています。ソースコードは [https://github.com/hitalin/notedeck](https://github.com/hitalin/notedeck) で確認できます。

## お問い合わせ

プライバシーに関する質問は GitHub Issues でお願いします: [https://github.com/hitalin/notedeck/issues](https://github.com/hitalin/notedeck/issues)

## 更新履歴

- 2026-05-17: 初版作成 (v1.0.0 リリースに合わせて)
