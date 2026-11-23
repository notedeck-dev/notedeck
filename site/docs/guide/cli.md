# ターミナルと AI エージェントから使う（notecli）

**notecli** は、NoteDeck が Misskey と話すために使っている部品を、単体のコマンドとして取り出したものです。画面なしで、タイムラインの取得・投稿・リアクション・検索などをターミナルから実行できます。NoteDeck 本体を入れていなくても動きます。

コマンドを実行できる AI エージェント（Claude Code、Codex など）に渡せば、エージェントが自分で Misskey を読み書きできます。結果は JSON で受け取れるので、シェルスクリプトや `jq` とも組み合わせられます。

::: warning 確認なしで実行されます
notecli はログインしたアカウントの権限でそのまま実行します。NoteDeck の AI チャットや MCP にある「書き込みの前に画面で確認する」「操作ごとに権限を絞る」仕組みは通りません。エージェントに投稿まで任せるなら、[守りを効かせたいとき](#守りを効かせたいとき)を先に読んでください。
:::

## インストール

::: code-group

```bash [GitHub Releases]
# NoteDeck と同じ Release に notecli-<版>-<環境> の名前で載っています
#   linux-amd64 / linux-arm64 / darwin-arm64 / windows-amd64.exe
gh release download --repo notedeck-dev/notedeck \
  --pattern 'notecli-*-linux-amd64' --output notecli
chmod +x notecli
sudo mv notecli /usr/local/bin/
```

```bash [AUR (Arch Linux)]
yay -S notecli-bin
```

```bash [Nix Flake]
nix profile install 'github:notedeck-dev/notedeck#notecli'
```

```bash [Cargo]
cargo install --git https://github.com/notedeck-dev/notedeck notecli
```

:::

入ったら `notecli doctor` で、データベース・トークンの保管先・サーバーとの疎通をまとめて確かめられます。

## ログインする

ログインは人が行います。最初に一度だけです。

```bash
notecli login misskey.io
```

1. 認証用の URL が表示されるので、ブラウザで開く
2. サーバーの画面で許可する
3. ターミナルに戻って Enter を押す

アカウントは何個でも登録できます。`notecli accounts` で一覧、`notecli logout @user@host` で削除です。

notecli のアカウントは NoteDeck 本体とは別に持ちます。本体でログイン済みでも、notecli では改めてログインしてください。

## 使ってみる

```bash
notecli timeline                 # ホームタイムライン
notecli timeline local -l 50     # ローカルを 50 件
notecli post "Hello from notecli!"
notecli post "下書き的なつぶやき" --visibility home --cw "独り言"
notecli react <ノートID> ":star:"
notecli search "Rust"
notecli notifications --keep-unread
```

アカウントが複数あるときは `-a` で選びます。省略すると最初に登録したアカウントになります。

```bash
notecli -a @taka@misskey.io timeline
```

### できること

| 分類 | コマンド |
|---|---|
| 読む | `timeline`（home / local / social / global）、`note`、`replies`、`thread`、`search`、`user`、`user-notes`、`emojis` |
| 自分宛て | `notifications`、`mentions`、`favorites` |
| 書く | `post`、`update`、`delete`、`renote` |
| 反応する | `react` / `unreact`、`favorite` / `unfavorite`、`follow` / `unfollow` |
| 管理 | `login`、`logout`、`accounts`、`doctor` |

細かい引数は `notecli --help` と、各コマンドの `--help`（例: `notecli post --help`）にあります。

### 出力の形

どのコマンドにも付けられます。

| オプション | 形 | 向いている用途 |
|---|---|---|
| なし | 人が読む複数行の表示 | 目で見る |
| `--json` | JSON の配列 / オブジェクト | AI エージェント、スクリプト |
| `--jsonl` | 1 行に 1 つの JSON | `jq` で流しながら処理する |
| `-c` / `--compact` | 1 行 1 件のタブ区切り | `fzf`、`grep`、`awk` |
| `--ids` | ID だけ | `xargs` に渡す |

```bash
# 直近 100 件から「Rust」を含むノートの ID を取り出す
notecli timeline -c -l 100 | grep "Rust" | cut -f1

# fzf で選んだノートにリアクションする
notecli timeline -c | fzf --with-nth=2.. | cut -f1 | xargs -I{} notecli react {} :star:

# 特定のユーザーのノートだけ ID を出す
notecli timeline --jsonl | jq -r 'select(.user.username == "taka") | .id'
```

失敗したときは終了コードが 0 以外になります。`--json` / `--jsonl` のときは、エラーも `{"error": "...", "message": "..."}` の形で標準エラー出力に出ます。

## AI エージェントに使わせる

エージェント側に特別な設定は要りません。notecli が PATH にあり、ログインが済んでいれば、エージェントはシェルから呼ぶだけです。

頼み方の例:

- 「`notecli` でホームタイムラインを 50 件読んで、話題を 3 行でまとめて」
- 「`notecli mentions` を見て、返信が要りそうなものを挙げて。返信の文面は案だけ出して、投稿はしないで」
- 「このリリースノートを要約して、`notecli post` で公開範囲 home で投稿して」

毎回説明しなくて済むように、エージェントの指示ファイル（Claude Code なら `CLAUDE.md`、Codex なら `AGENTS.md`）に書いておけます。

```markdown
## Misskey

- Misskey の読み書きは `notecli` を使う。使い方は `notecli --help`
- 結果を読むときは `--json` を付ける
- アカウントは `-a @user@host` で明示する
- 通知を読むときは `--keep-unread` を付ける（付けないと全部既読になる）
- 投稿・リノート・削除・フォローは、実行前に文面と対象を見せて確認を取る
```

押さえておくと良い点:

- **通知は読むと既読になります。** `notecli notifications` は、公式の Web と同じく取得した時点で全部既読にします。エージェントに下見させるだけなら `--keep-unread` を付けます
- **投稿の既定の公開範囲は public です。** 控えめにしたいなら `--visibility home` や `--local-only` を指示に入れておきます
- **ログインはエージェントに任せない。** 認可はブラウザで人が行う操作です

## 守りを効かせたいとき

notecli は Misskey のトークンを直接使う道具で、間に NoteDeck の確認や権限は入りません。エージェントが読んだノートに「これを投稿しろ」と書いてあって、そのまま従ってしまう、といった事故を止めるものは、エージェント側の確認設定と指示だけです。

次のどれかで備えられます。

- **エージェントの実行許可を絞る。** 読み取りのコマンド（`notecli timeline` など）だけを自動で許可し、`notecli post` などの書き込みは毎回確認にします。Claude Code なら権限設定でコマンド単位に決められます
- **専用のアカウントを使う。** エージェントに任せる用のアカウントを別に作り、`-a` でそれだけを使わせます
- **NoteDeck の MCP を使う。** 書き込みのたびに NoteDeck の画面で確認が出て、トークンごとにできる操作を絞れます。NoteDeck を起動している間だけ使えます → [AI と使う → 外部の AI エージェントから使う](/docs/guide/ai#外部の-ai-エージェントから使う-mcp)

| | notecli | NoteDeck の MCP |
|---|---|---|
| NoteDeck 本体 | 要らない | 起動している必要がある |
| 書き込み前の確認 | エージェント側の設定しだい | NoteDeck の画面で必ず出る |
| 操作ごとの権限 | なし（ログインしたアカウントの全権限） | トークンごとに選べる |
| 向いている使い方 | サーバーや CI、スクリプト、読み取り中心の作業 | ふだん使いの端末で、投稿まで任せる |

## データの置き場

- アカウントの一覧とノートのキャッシュ: OS のデータフォルダの `notecli/notecli.db`（Linux は `~/.local/share/notecli/`）
- トークン: Releases と AUR のバイナリは上のデータベースに保存します。Cargo で自分でビルドしたものは OS のキーチェーンに保存し、Linux で Secret Service が無い環境（サーバー、WSL2、コンテナ）では暗号化したファイルに保存します

トークンが入っているので、このフォルダを人に渡したり、公開のリポジトリに入れたりしないでください。

## 困ったとき

- **`no accounts found`**: まだログインしていません。`notecli login <ホスト>` を実行します
- **認証エラーになる**: `notecli doctor` でトークンの有効性とサーバーとの疎通を確かめます。サーバー側でアプリの許可を取り消した場合は、`logout` してから `login` し直します
- **NoteDeck 本体のアカウントが出てこない**: 置き場が別です。notecli で改めてログインします
