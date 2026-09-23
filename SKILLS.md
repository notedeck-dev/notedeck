# SKILLS — NoteDeck AI スキルリファレンス

NoteDeck の AI チャット機能で使う **SKILL (= Markdown 形式の指示書)** を書くための技術リファレンス。

> **入門ガイド・ベストプラクティス例集・配布手順** は misstore 側のドキュメント ([CONTRIBUTING](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [レジストリ形式](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md)) を参照してください。本書は NoteDeck コア仕様に対応する **API リファレンス** に近い性格です。

---

## 1. SKILL とは

- AI チャットの **system prompt に追加されるテキストフラグメント**
- AI の振る舞い・キャラ性・応答ガイドラインを Markdown で記述
- Tauri の `app_data_dir/notedeck/skills/*.md` に置かれる (Linux: `~/.local/share/com.notedeck.desktop/notedeck/skills/`、macOS: `~/Library/Application Support/com.notedeck.desktop/notedeck/skills/`、Windows: `%APPDATA%\com.notedeck.desktop\notedeck\skills\`)
- 複数の SKILL は順に連結されて 1 つの system prompt になる
- [misstore](https://store.notedeck.io) で配布可能 (Markdown 1 ファイル単位、[配布手順](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md))

スキルは **AI に "読ませる"** 指示書であり、AI が "実行できる" 機能 (= **capability**) とは別物です。

| | スキル | Capability |
|---|---|---|
| 形式 | Markdown | TypeScript / AiScript コード |
| 役割 | AI への指示 (read-only) | AI が呼べる関数 (tool calling) |
| 配布 | misstore で配布 | NoteDeck 本体に実装 or AiScript プラグイン |
| 例 | 「丁寧に応答する」 | `time.now()` → ISO 8601 |

### 1.1 起動 mode (frontmatter `mode`)

skill は frontmatter の `mode` で「いつ system prompt に乗るか」を決める。

| mode | 動作 | 用途 |
|---|---|---|
| `always` | 全 AI セッションで常時注入 | アプリ全体の振る舞いガイド (例: メモの読み方) |
| `manual` | UI でユーザーがトグルした時だけ注入 | persona 切替、明示起動するデモ |
| `trigger` | user 入力に `triggers[]` のいずれかが部分一致したターンだけ session-only に注入 | 特定話題のときだけ必要な専門 skill (例: 「プラグイン作って」で起動するプラグイン作者 skill) |
| `heartbeat` | HEARTBEAT daemon が tick ごとに body を AI に渡す (チャットには注入されない) | 定期実行する自己編集・監視 skill |

`mode: trigger` の例:

```yaml
---
id: plugin-author
name: プラグイン作者
mode: trigger
triggers:
  - プラグイン
  - plugin
  - aiscript
---
```

- マッチは大文字小文字無視の **部分一致** (`String.prototype.includes`)
- マッチしないターンでは body が一切注入されない (= token 節約)
- 複数 skill が同じ triggers を持てば、それらは依存関係としてセット起動できる
  (例: `plugin-author` と `aiscript-author` を同じ triggers で常に同伴させる)

### 1.2 heartbeat skill と cheapCheck (frontmatter `cheapCheckCapabilities`)

`mode: heartbeat` の skill は frontmatter で `cheapCheckCapabilities` を宣言する:

```yaml
---
id: improvement-pulse
mode: heartbeat
cheapCheckCapabilities: [logs.recent]
---
```

- 宣言した capability を tick ごとに実行し、**結果 hash が前回 tick と同じ間は AI 呼び出し自体をスキップ**する (`useHeartbeatDaemon.ts`)
- **未宣言の heartbeat skill は毎 tick AI が呼ばれる** = 観測対象に変化がなくても課金が走る
- tick ごとに必ず結果が変わる capability (`time.now` 等) を入れると hash が常に変わりスキップが効かない。「何が変わったら起きるべきか」から逆算して選ぶ
- 機構全体は AI 設定の `heartbeat.cheapCheck.enabled` で on/off、`maxSkipHours` でスキップ上限を制御

---

## 2. AI に渡される情報の全体像

AI チャットの 1 ターンで AI が受け取るのは:

```
[system prompt]
  ↓ skills/*.md の連結
  ↓ <notedeck-context> ブロック (AI 設定で許可された情報のみ)
  ↓
[history (messages 配列)]
  ↓ 過去の user / assistant ターン
  ↓
[最新の user message]
```

加えて、AI は **tools 配列** を介して任意の capability を呼び出せます (= 関数として実行)。tool 呼び出しの結果は次の AI ターンへ `tool_result` として返送されます。

---

## 3. AI が触れる context (毎ターン渡される)

system prompt 末尾に注入される `<notedeck-context>` ブロックの構造:

```xml
<notedeck-context>
  <currentAccount>{ ... }</currentAccount>
  <currentColumn>{ ... }</currentColumn>
  <visibleNotes|visibleNotifications|visibleDriveItems|visibleItems>[ ... ]</visibleNotes>
  <recentConversation>[ ... ]</recentConversation>
  <memos>[ ... ]</memos>
  <persona>...</persona>
</notedeck-context>
```

各ブロックの中身は **AI 設定 (`settings.json` の `ai.dataSources`) でユーザーが許可したものだけ** 含まれます (persona は dataSources で on/off せず、session が persona skill を持つときのみ注入)。

### 3.1 `<currentAccount>` (`dataSources.currentAccount`)

| フィールド | 型 | 例 |
|---|---|---|
| `id` | string | `acc-1` |
| `host` | string | `misskey.example` |
| `userId` | string | `9abc...` |
| `username` | string | `taka` |
| `displayName` | string \| null | `Taka` |
| `avatarUrl` | string \| null | URL |
| `software` | string | `misskey-dev/misskey` |
| `hasToken` | boolean | `true` |

**credential 系フィールドは自動的に除去**されます (詳細は §6)。

### 3.2 `<currentColumn>` (`dataSources.currentColumn`)

直近にフォーカスした **TIMELINE_LIKE 系** カラム (timeline / list / antenna / mentions / channel / favorites / clip / user / specified / search / role / chat) の情報。フォーカス未操作なら左端の TIMELINE_LIKE カラムを fallback として使用。

| フィールド | 型 |
|---|---|
| `id` | string |
| `type` | ColumnType |
| `name` | string \| null |
| `accountId` | string \| null |

### 3.3 `<visibleNotes>` / `<visibleNotifications>` / `<visibleDriveItems>` / `<visibleItems>` (`dataSources.visibleNotes`)

ブロック名は **column の type で自動分岐**:

| column type | ブロック名 |
|---|---|
| timeline / list / antenna / mentions / channel / favorites / clip / user / specified / search / role / chat | `<visibleNotes>` |
| notifications | `<visibleNotifications>` |
| drive | `<visibleDriveItems>` |
| その他 | `<visibleItems>` |

中身 (note projection の例):

```json
[
  { "id": "9abc", "userId": "u1", "username": "taka", "text": "hello", "createdAt": "..." },
  { "id": "9abd", "userId": "u2", "text": "[CW: spoiler]", ... }
]
```

- **上限 10 件** (`MAX_VISIBLE_NOTES`)
- CW 付きノートは `text` が `[CW: <理由>]` に置換される (本文は除外)
- 通知 / ドライブも各 kind ごとの projection で必要フィールドのみ抽出

### 3.4 `<recentConversation>` (`dataSources.recentConversation`)

直近 20 ターンの会話 (`MAX_RECENT_TURNS=20`)。

```json
[
  { "role": "user", "content": "今何時?" },
  { "role": "assistant", "content": "..." }
]
```

注: API への `messages` パラメータでも history は渡されるので、これは「テキスト形式の補助参照」として AI に再度提示する目的です (= 長い会話で AI が context を見失うのを防ぐ)。

### 3.5 `<memos>` (`dataSources.memos`)

ユーザーのローカルメモを AI に永続記憶として渡すブロック。`memo:<id>` markdown link を経由して **link expand** (本文展開) + **referencedBy** (被参照リスト) が組み立てられる (#494)。AI が `memos.create` / `memos.update` で書き込み、次ターンで `<memos>` として読み戻す = persistent memory の最小プリミティブ。

```json
[
  { "id": "memo-abc", "title": "...", "body": "...", "tags": ["..."], "referencedBy": ["memo-xyz"] }
]
```

### 3.6 `<persona>` (session 由来、dataSources では制御しない)

`session.personaSkillId` が指定された AI セッションでのみ注入される (#491)。AI に「あなたは <displayName> として振る舞え」「memos.create を呼ぶときは `authorId='<id>'` を指定」と明示する。テンプレートに `<persona>` block を使う skill は `isPersona: true` フラグで宣言する。

---

## 4. AI が呼べる capability (= tool calling)

builtin capability の実体は `src/capabilities/builtins/` 配下にあり、そこの unique id が正本。subject 別にグループ化すると以下:

### 4.0 capability 一覧

<!-- capabilities:begin -->
<!-- 生成物: 正本は crates/notecore/capabilities.json5、生成は pnpm gen:capabilities -->

| subject | capability ID | 用途 | 権限 | 確認 |
|---|---|---|---|---|
| account | `account.current` | 現在のアカウント情報 | `account.read` | — |
| account | `account.list` | アカウント一覧 | `account.read` | — |
| ai | `ai.chat` | AI に問い合わせる (AI からは呼べない) | `ai.invoke` | — |
| ai | `ai.listPersonas` | persona 用 skill 一覧 | `skills.read` | — |
| ai | `ai.sessions.list` | AI セッション一覧 | `ai.sessions.read` | — |
| ai | `ai.sessions.read` | AI セッションを読む | `ai.sessions.read` | — |
| ai | `ai.sessions.search` | AI セッション本文を検索 | `ai.sessions.read` | — |
| ai | `ai.setPersona` | AI persona を切替 | `ai.persona.write` | あり |
| aiscript | `aiscript.logs` | AiScript 実行ログを取得 | `logs.read` | — |
| aiscript | `aiscript.validate` | AiScript を構文検証する | — | — |
| announcements | `announcements.list` | サーバーアナウンス一覧 | `account.read` | — |
| antenna | `antenna.list` | 自分のアンテナ一覧 | `account.read` | — |
| antenna | `antenna.notes` | アンテナの note | `notes.read` | — |
| backup | `backup.create` | バックアップを作成 | `backup.create` | あり |
| channel | `channel.list` | 自分のフォロー中チャネル | `account.read` | — |
| channel | `channel.notes` | チャネルの note | `notes.read` | — |
| chat | `chat.react` | チャットメッセージにリアクション | `notes.react` | あり |
| chat | `chat.unreact` | チャットメッセージのリアクションを解除 | `notes.react` | あり |
| clipboard | `clipboard.read` | クリップボードを読む | `clipboard` | — |
| clipboard | `clipboard.write` | クリップボードに書き込む | `clipboard` | — |
| clips | `clips.addNote` | クリップにノートを追加 | `clips.write` | あり |
| clips | `clips.create` | クリップを作成 | `clips.write` | あり |
| clips | `clips.list` | クリップ一覧 | `clips.read` | — |
| clips | `clips.notes` | クリップ内のノート一覧 | `clips.read`, `notes.read` | — |
| clips | `clips.removeNote` | クリップからノートを削除 | `clips.write` | あり |
| column | `column.active` | アクティブなカラムを取得 | `deck.read` | — |
| column | `column.add` | カラムを追加 | `deck.write` | — |
| column | `column.focusedNote` | フォーカス中のノートを取得 | `notes.read` | — |
| column | `column.list` | カラム一覧 | `deck.read` | — |
| column | `column.move` | カラムを移動 | `deck.write` | — |
| column | `column.remove` | カラムを削除 | `deck.write` | — |
| column | `column.updateSettings` | カラム設定を更新 | `deck.write` | — |
| drafts | `drafts.create` | 下書きを作成 | `drafts.write` | あり |
| drafts | `drafts.delete` | 下書きを削除 | `drafts.write` | あり |
| drafts | `drafts.list` | 下書き一覧 | `drafts.read` | — |
| drafts | `drafts.update` | 下書きを更新 | `drafts.write` | あり |
| drive | `drive.list` | ドライブファイル一覧 | `drive.read` | — |
| favorites | `favorites.add` | お気に入りに追加 | `notes.react` | あり |
| favorites | `favorites.remove` | お気に入りから削除 | `notes.react` | あり |
| federation | `federation.chart` | 連合チャート | `account.read` | — |
| federation | `federation.instance` | 連合先インスタンス詳細 | `account.read` | — |
| federation | `federation.instances` | 連合先インスタンス一覧 | `account.read` | — |
| files | `files.export` | ファイルをローカルに保存 | `files.export` | あり |
| flash | `flash.list` | Misskey Play 一覧 | `account.read` | — |
| flash | `flash.show` | Misskey Play 詳細 | `account.read` | — |
| gallery | `gallery.list` | Gallery 一覧 | `account.read` | — |
| http | `http.fetch` | 外部 HTTP リクエスト | `network.external` | あり |
| keybinds | `keybinds.list` | キーバインド一覧 | — | — |
| keybinds | `keybinds.reset` | キーバインドを default に戻す | `keybinds.write` | あり |
| keybinds | `keybinds.resetAll` | 全キーバインドを default に戻す | `keybinds.write` | あり |
| keybinds | `keybinds.set` | キーバインドを設定 | `keybinds.write` | あり |
| list | `list.addUser` | リストにユーザーを追加 | `account.write` | あり |
| list | `list.list` | 自分のリスト一覧 | `account.read` | — |
| list | `list.removeUser` | リストからユーザーを削除 | `account.write` | あり |
| logs | `logs.recent` | 最近のログを取得 | `logs.read` | — |
| memos | `memos.backlinks` | メモのバックリンク | `memos.read` | — |
| memos | `memos.create` | メモを作成 | `memos.write` | あり |
| memos | `memos.delete` | メモを削除 | `memos.write` | あり |
| memos | `memos.list` | メモを列挙 | `memos.read` | — |
| memos | `memos.revert` | メモを過去の状態に戻す | `memos.write` | あり |
| memos | `memos.search` | メモを検索 | `memos.read` | — |
| memos | `memos.update` | メモを更新 | `memos.write` | あり |
| meta | `meta.activeSkills` | active な skill 一覧 | — | — |
| meta | `meta.config` | 現在の AI 設定スナップショット | — | — |
| meta | `meta.heartbeat` | HEARTBEAT 設定スナップショット | — | — |
| meta | `meta.permissions` | 現在の permission を取得 | — | — |
| meta | `meta.persona` | 現在の AI persona | — | — |
| metrics | `metrics.read` | 実行時メトリクスを取得 | `deck.read` | — |
| misstore | `misstore.search` | MisStore を検索 | `network.external` | — |
| navbar | `navbar.list` | ナビバー構成を読む | — | — |
| navbar | `navbar.reset` | ナビバー構成を default に戻す | `navbar.write` | あり |
| navbar | `navbar.set` | ナビバー構成を上書き | `navbar.write` | あり |
| notes | `notes.children` | リプライ取得 | `notes.read` | — |
| notes | `notes.create` | ノートを投稿 | `notes.write` | あり |
| notes | `notes.delete` | ノートを削除 | `notes.write` | あり |
| notes | `notes.pin` | ノートをプロファイルに pin | `notes.write` | あり |
| notes | `notes.react` | リアクションする | `notes.react` | あり |
| notes | `notes.search` | ノート検索 | `notes.read` | — |
| notes | `notes.searchArchive` | 手元の索引を検索 | `notes.readArchive` | — |
| notes | `notes.show` | ノート取得 | `notes.read` | — |
| notes | `notes.timeline` | タイムライン取得 | `notes.read` | — |
| notes | `notes.unpin` | ノートの pin を解除 | `notes.write` | あり |
| notes | `notes.unreact` | リアクションを解除 | `notes.react` | あり |
| notes | `notes.user` | ユーザーのノート取得 | `notes.read` | — |
| notifications | `notifications.list` | 通知一覧 | `notifications` | — |
| notifications | `notifications.markRead` | 通知をすべて既読化 | `notifications` | あり |
| pages | `pages.list` | Pages 一覧 | `account.read` | — |
| pages | `pages.show` | Page 詳細 | `account.read` | — |
| performance | `performance.applySlider` | パフォーマンススライダーを適用 | `performance.write` | あり |
| performance | `performance.list` | パフォーマンス設定一覧 | — | — |
| performance | `performance.reset` | パフォーマンス値を default に戻す | `performance.write` | あり |
| performance | `performance.resetAll` | 全パフォーマンス値を default に戻す | `performance.write` | あり |
| performance | `performance.set` | パフォーマンス値を設定 | `performance.write` | あり |
| plugins | `plugins.create` | プラグインを作成 | `plugins.write` | あり |
| plugins | `plugins.delete` | プラグインを削除 | `plugins.write` | あり |
| plugins | `plugins.history` | プラグインの編集履歴 | `plugins.read` | — |
| plugins | `plugins.install` | MisStore からプラグインを入れる | `plugins.write`, `network.external` | あり |
| plugins | `plugins.list` | プラグイン一覧 | `plugins.read` | — |
| plugins | `plugins.read` | プラグインの AiScript を読む | `plugins.read` | — |
| plugins | `plugins.revert` | プラグインを過去の状態に戻す | `plugins.write` | あり |
| plugins | `plugins.setActive` | プラグインの有効/無効を切替 | `plugins.write` | あり |
| plugins | `plugins.uninstall` | プラグインを削除 | `plugins.write` | あり |
| plugins | `plugins.update` | プラグインの AiScript を更新 | `plugins.write` | あり |
| queries | `queries.history` | クエリの編集履歴 | `queries.read` | — |
| queries | `queries.revert` | クエリを過去の状態に戻す | `queries.write` | あり |
| registry | `registry.delete` | registry の値を削除 | `account.write` | あり |
| registry | `registry.get` | registry の値を取得 | `account.read` | — |
| registry | `registry.listKeys` | registry の key 一覧 | `account.read` | — |
| registry | `registry.set` | registry に値を書込 | `account.write` | あり |
| role | `role.notes` | ロールの note | `notes.read` | — |
| sidebar | `sidebar.toggle` | サイドバーで開閉 | `deck.write` | — |
| skills | `skills.append` | スキル本文に追記 | `skills.write` | あり |
| skills | `skills.create` | スキルを作成 | `skills.write` | あり |
| skills | `skills.history` | スキルの編集履歴を取得 | `skills.read` | — |
| skills | `skills.install` | MisStore からスキルを入れる | `skills.write`, `network.external` | あり |
| skills | `skills.list` | スキル一覧 | `skills.read` | — |
| skills | `skills.read` | スキル本文を読む | `skills.read` | — |
| skills | `skills.replaceSection` | スキルのセクションを置換 | `skills.write` | あり |
| skills | `skills.revert` | スキルを過去の編集前状態に戻す | `skills.write` | あり |
| skills | `skills.toggle` | スキルの有効/無効を切替 | `skills.write` | — |
| skills | `skills.uninstall` | スキルを削除 | `skills.write` | あり |
| styles | `styles.append` | カスタム CSS に追記 | `styles.write` | あり |
| styles | `styles.history` | カスタム CSS の編集履歴 | — | — |
| styles | `styles.read` | カスタム CSS を読む | — | — |
| styles | `styles.revert` | カスタム CSS を過去の状態に戻す | `styles.write` | あり |
| styles | `styles.write` | カスタム CSS を全置換 | `styles.write` | あり |
| tasks | `tasks.run` | タスク実行 | `tasks.run` | — |
| theme | `theme.apply` | テーマを適用 | `deck.write` | — |
| theme | `theme.create` | テーマを作成 | `theme.write` | あり |
| theme | `theme.history` | テーマの編集履歴 | — | — |
| theme | `theme.install` | MisStore からテーマを入れる | `theme.write`, `network.external` | あり |
| theme | `theme.list` | テーマ一覧 | — | — |
| theme | `theme.read` | テーマの内容を読む | — | — |
| theme | `theme.revert` | テーマを過去の状態に戻す | `theme.write` | あり |
| theme | `theme.uninstall` | テーマを削除 | `theme.write` | あり |
| theme | `theme.update` | テーマを更新 | `theme.write` | あり |
| time | `time.now` | 現在時刻を取得 | — | — |
| ui | `ui.notify` | デスクトップ通知 | `notifications` | — |
| user | `user.follow` | ユーザーをフォロー | `account.write` | あり |
| user | `user.followers` | フォロワー一覧 | `account.read` | — |
| user | `user.following` | フォロー一覧 | `account.read` | — |
| user | `user.lookup` | ユーザー検索 | `account.read` | — |
| user | `user.mute` | ユーザーをミュート | `account.write` | あり |
| user | `user.renoteMute` | リノートだけミュート | `account.write` | あり |
| user | `user.search` | ユーザーをあいまい検索 | `account.read` | — |
| user | `user.unfollow` | ユーザーのフォローを解除 | `account.write` | あり |
| user | `user.unmute` | ユーザーのミュートを解除 | `account.write` | あり |
| user | `user.unrenoteMute` | リノートミュートを解除 | `account.write` | あり |
| vault | `vault.fetch` | Vault 接続で HTTP リクエスト | `vault.use` | あり |
| widgets | `widgets.create` | ウィジェットを作成 | `widgets.write` | あり |
| widgets | `widgets.delete` | ウィジェットを削除 | `widgets.write` | あり |
| widgets | `widgets.history` | ウィジェットの編集履歴 | `widgets.read` | — |
| widgets | `widgets.install` | MisStore からウィジェットを入れる | `widgets.write`, `network.external` | あり |
| widgets | `widgets.list` | ウィジェット一覧 | `widgets.read` | — |
| widgets | `widgets.read` | ウィジェットの AiScript を読む | `widgets.read` | — |
| widgets | `widgets.revert` | ウィジェットを過去の状態に戻す | `widgets.write` | あり |
| widgets | `widgets.setAutoRun` | ウィジェットの自動実行を切替 | `widgets.write` | — |
| widgets | `widgets.uninstall` | ウィジェットを削除 | `widgets.write` | あり |
| widgets | `widgets.update` | ウィジェットの AiScript を更新 | `widgets.write` | あり |
| windows | `windows.close` | ウィンドウを閉じる | `deck.write` | — |
| windows | `windows.closeAll` | 全ウィンドウを閉じる | `deck.write` | あり |
| windows | `windows.focus` | ウィンドウを前面に | `deck.write` | — |
| windows | `windows.list` | 開いているウィンドウ一覧 | — | — |
| windows | `windows.open` | ウィンドウを開く | `deck.write` | — |

<!-- capabilities:end -->

各 capability の params / 戻り値の詳細は宣言ファイル `crates/notecore/capabilities.json5` を参照 (実装は `src/capabilities/builtins/<subject>.ts`)。上の表はそこから生成され (`pnpm gen:capabilities`)、最新かどうかは `tests/lint/capabilityDeclarations.test.ts` が検査する。

### 4.0.1 永久に塞ぐ capability (AI に開放しない)

以下は安全性 / セキュリティ上 AI 開放しない方針:

- `user.block` / `user.unblock` / `user.report` — ブロック / 通報は人手判断必須、AI に委ねない
- `heartbeat.write` (HEARTBEAT daemon 設定変更) — daemon 自己変更で暴走リスク
- `account.add` / `account.logout` — 認証系操作は AI 不可
- `announcements.read` (既読化) — AI が勝手に既読化して読み逃しを起こすため
- like / unlike 系 (pages / gallery / flash) — 通知が飛ぶ副作用
- plugin install from URL — AI が任意 URL から実行可能になる

### 4.0.2 adapter 経由 / Tauri 直呼び の使い分け

capability は原則 **`ApiAdapter` 経由** (`src/adapters/types.ts` + `src/adapters/misskey/api.ts`) で API を叩く (= フォーク対応の道を残す)。Tauri commands を直接呼ぶのは下記の例外のみ:

- `registry.*` — Misskey 専用の KV ストア API、フォーク差異想定外
- `notes.searchArchive` — ローカル DB (SQLite) の読取で Misskey API ではない
- `chat.*` — Misskey 新 Chat API、フォーク未対応領域 (memory `project_misskey_chat_api_facts.md`)

新規 capability では adapter にメソッドを足してから capability を書くのが正攻法。

### 4.1 capability の id 命名規則

- **`<subject>.<verb>` のドット区切り** (例: `notes.read`, `theme.apply`)
- AI に渡す tool name は Anthropic / OpenAI の制約 (`^[a-zA-Z0-9_-]{1,128}$`) に合わせて **`.` → `_`** に自動変換される (`time.now` → `time_now`)
- AI からの応答も sanitized name で来るが、dispatcher が逆引きするので意識不要

### 4.2 tool calling のループ

1. AI が `tool_use` (Anthropic) / `tool_calls` (OpenAI) を返す
2. NoteDeck は `dispatchCapability(name, params)` で実行 (permissions 照合 + execute)
3. 結果を **`tool_result` メッセージとして history に追加** + 続きの応答を AI から取得
4. **連続 tool 呼び出しの上限は 5 回** (`MAX_TOOL_ROUNDS=5`)、超えるとユーザー応答に警告メッセージ + 強制終了

### 4.3 dispatchCapability の戻り値

```ts
{ ok: true, result: <any> }
| { ok: false, code: 'unknown_capability', error: string }
| { ok: false, code: 'permission_denied', error: string }
| { ok: false, code: 'execute_failed', error: string }
| { ok: false, code: 'preflight_failed', error: string }
| { ok: false, code: 'user_cancelled', error: string }
```

`preflight_failed` は capability の `preflight` (例: AiScript の構文検証) で弾かれた場合、`user_cancelled` は `requiresConfirmation` の確認ダイアログで拒否された場合。

AI には `tool_result` の `content` として文字列化された結果が返される (失敗時はエラー文字列)。

---

## 5. permissions スキーマ

権限は principal (`ai.chat` / `ai.heartbeat` / `plugin` / `external` / `scratchpad`) 別に `<config dir>/notedeck/permissions.json5` で管理される (#712 で AI 設定から独立ファイルに隔離 — capability からは書き換え不能)。各 principal のプロファイルは `preset` + `custom` で表現:

| preset | readonly | safe | full | custom |
|---|---|---|---|---|
| 読み取り系 (`notes.read` / `account.read` / `drive.read` / `memos.read` / `clips.read` / `drafts.read` / `skills.read` / `widgets.read` / `plugins.read` / `ai.sessions.read` / `logs.read` / `deck.read`) | ✓ | ✓ | ✓ | 個別 |
| 軽い書き込み (`notes.react` / `clips.write` / `drafts.write` / `clipboard` / `notifications` / `tasks.run` / `ai.invoke` / `deck.write`) | | ✓ | ✓ | 個別 |
| 自己編集系 (`memos.write` / `skills.write` / `widgets.write` / `plugins.write`) | | ✓ | ✓ | 個別 |
| UI 設定 write (`theme.write` / `styles.write` / `navbar.write` / `keybinds.write` / `performance.write`) | | | ✓ | 個別 |
| 高リスク write (`notes.write` / `account.write` / `account.actAs` / `drive.write` / `network.external` / `vault.use` / `ai.persona.write` / `files.export` / `backup.create`) | | | ✓ | 個別 |

- キーの一覧は `src/permissions/schema.ts` の `PERMISSION_KEYS` が正本 (capability の `permissions[]` 宣言が語彙を定義する)
- capability の `permissions: PermissionKey[]` 宣言と principal の解決値 (`resolveFor(principal)`) を **AND 照合** で評価。不許可なら `permission_denied`
- principal 別デフォルト: `ai.chat` = safe / `ai.heartbeat` = readonly (無人実行は安全側) / `plugin` = safe + `network.external` / `external` = readonly からローカル私的データ read (`memos.read` / `drafts.read` / `skills.read` 等) を落とした縮小 custom
- resolve 時の恒久 clamp (保存値より優先): `skills.write` / `ai.persona.write` / `tasks.run` / `backup.create` は plugin / external に恒久 deny (full preset でも拒否)。plugin の `vault.use` は clamp しない (既定 OFF で、接続ごとの `exposedTo` 開示が要る二段 gate #759)。external は Misskey コンテンツ read 4 キー (`notes.read` / `account.read` / `drive.read` / `clips.read`) が常時 ON (トークン発行 = read への同意)
- `custom` プリセットでは個別に on/off
- 自己編集系は `safe` 以上で許可。write 系 capability は全て dispatch 直前の確認ダイアログで enforce される (§5.2)

### 5.1 高リスク権限

`HIGH_RISK_PERMISSION_KEYS` (`notes.write` / `account.write` / `account.actAs` / `drive.write` / `network.external` / `vault.use` / `skills.write` / `ai.persona.write` / `memos.write` / `tasks.run` / `files.export` / `backup.create`) は UI に warning アイコンで表示。dispatch 直前に **確認ダイアログ** で enforce される (引数 JSON は code block + Shiki シンタックスハイライトで表示)。permission 変更は再起動なしで反映 (dispatch 直前に `reloadPermissionsConfig()` で permissions.json5 を再読込 — 外部エディタでの編集も次回 dispatch から効く)。

### 5.2 自己改変系 capability の安全弁

skill / widget / plugin / theme の **書き込み系 capability** (`skills.create|append|replaceSection` / `widgets.create|update|delete` / `plugins.create|update|delete|setActive` / `theme.create|update|revert` 等) は `aiTool: true` で tool calling に露出する (plugin 導入時の `aiTool: false` ガードは #107 で AI 開放に伴い廃止)。現在の安全弁は 3 層:

1. **permission**: `skills.write` / `widgets.write` / `plugins.write` / `theme.write` は preset (`safe` / `full`) か custom で許可されたときだけ通る。#712 以降は principal 別に解決され、`skills.write` / `ai.persona.write` (AI 指示チャネル) は plugin / external principal に対し保存値に関わらず恒久 deny (confused deputy 防止)
2. **確認ダイアログ**: `requiresConfirmation` で dispatch 直前にユーザー承認 (#714 の「今後確認しない」で capability 単位のスキップ可)
3. **capability 個別ガード**: `skills.create` の frontmatter 遮断 + id 内部生成、`aiscript.validate` preflight 等

`aiTool: false` が残るのは `ai.chat` (プラグイン専用 — AI 自身からの再帰呼び出し防止) のみ。

---

## 6. credential 自動マスキング

`<currentAccount>` や capability の戻り値に含まれる **credential 系フィールドは AI に渡る前に自動的に除去** されます。

### 除去されるキー (denylist)

```
token, i, accessToken, refreshToken, apiKey, password, secret
```

特に **`i` は Misskey の認証トークンキー** で、これが AI に流れると重大な情報漏洩になります。`stripCredentials()` が再帰的にすべてのオブジェクト・配列を walk して除去します。

### CW (Content Warning) のマスキング

CW 付きノートは `text` フィールドが `[CW: <理由>]` に置換され、本文は AI に届きません。AI は CW の存在と理由だけ認識できます。

---

## 7. SKILL の書き方 — 5 原則

### 1. AI の役割と口調を冒頭で固定

```markdown
あなたは Misskey クライアント NoteDeck の操作補助 AI です。
日本語で簡潔に応答してください。専門用語の濫用は避けてください。
```

### 2. データソースの優先順位を明示

context block (毎ターン渡される) と capability (明示的に呼ぶ) は使い分け:

```markdown
情報の取り方:
- 画面に見えているノートを参照するときは <visibleNotes> をまず見る
- アカウント情報は <currentAccount> をまず見る (capability を呼び直す必要なし)
- 「全アカウント」が必要な時だけ account.list を呼ぶ
```

→ context にあるものは tool で再取得させない (= 不要なラウンドトリップを防ぐ)。

### 3. 応答形式を厳密に指定

```markdown
応答フォーマット:
- 1 行目: 結論を 30 文字以内で
- 2 行目以降: Markdown 箇条書き、最大 5 項目
- 絵文字は控えめに (1 応答 1 個まで)
```

LLM は曖昧な指示で長文を返しがちなので、形式制約が効きます。

### 4. 失敗時のフォールバックを書く

```markdown
データが取れないときの挙動:
- <visibleNotes> が空 → 「画面に対象のノートがありません」
- tool が permission_denied → 「現在の権限設定では実行できません (AI 設定→権限を確認)」
- 不明な要求 → 推測せず提案で返す
```

### 5. 明示的に capability 名を書く

```markdown
テーマ変更を頼まれたら:
1. theme.list で id を取得
2. ユーザー指定の名前と一致するテーマの id を選ぶ
3. theme.apply(id) で適用
```

→ 「テーマを変えて」だけだと AI が `theme.apply` を呼ばずテキストだけで「変えました」と嘘応答するケースが防げます。

---

## 8. 例: 画面ノート要約スキル

```markdown
# 画面ノート要約スキル

ユーザーが「要約して」「まとめて」と言ったときの挙動:

1. <visibleNotes> ブロックを確認する
   - 空なら "画面にノートがありません。タイムラインカラムを開いてからもう一度お試しください" と返して終了
2. ノートがあれば 3 行で日本語要約:
   - 1 行目: "<件数> 件: <共通テーマ>"
   - 2 行目: 最も話題になっているノート 1 件 (`@username: 内容`)
   - 3 行目: トピック分布 (例: "技術 5 / 雑談 3 / 告知 2")
3. CW 付きノート ([CW: 理由]) は本文ではなく "(CW: <理由>)" として扱う
4. 100 文字を超える本文は 30 文字 + … で省略
5. 余計な前置きを書かない (「要約します」等は省く)

絶対やらないこと:
- "ノートを取得しています…" のような進捗報告
- 推測で内容を補完する (見えてない情報を作らない)
```

---

## 9. 例: テーマ切替スキル

```markdown
# テーマ切替スキル

ユーザーが「テーマを <名前> に変えて」「ダークにして」「明るくして」等と言ったとき:

1. theme.list で id 一覧を取得
2. ユーザー指定の名前と各テーマの name を fuzzy match
   - 完全一致 → そのテーマ
   - 部分一致 → 最初の候補 (複数あれば候補をリストして確認)
   - "ダーク" "明るく" 等の汎用語 → installed の中で該当 base のテーマ
3. theme.apply(id) で適用
4. "<テーマ名> を適用しました" と返す

失敗時:
- 該当 0 件 → "「<指定>」というテーマは見つかりません。インストール済み: <name 一覧>"
- match 複数 → "候補: <候補リスト>。どれにしますか?"
```

---

## 10. 制約 / Known Limits

| 項目 | 値 | 補足 |
|---|---|---|
| `<visibleNotes>` 上限 | 10 件 | `MAX_VISIBLE_NOTES` |
| `<recentConversation>` 上限 | 20 ターン | `MAX_RECENT_TURNS` |
| tool 呼び出しループ上限 | 5 回 | `MAX_TOOL_ROUNDS` |
| context block 全 OFF | 出力されない | `<notedeck-context>` タグごと省略 |
| 高リスク capability の enforcement | 確認ダイアログで enforce | code block + Shiki ハイライト表示 |
| 自己改変系 capability (skill/widget/plugin/theme write) | permission + 確認ダイアログで enforce | 詳細は §5.2 (旧 `aiTool:false` ガードは #107 で廃止) |
| AiScript プラグインからの capability 呼び出し | 実装済み | `Nd:call` / `Nd:capabilities` / `Nd:on` / `Nd:register_command` options |
| MisStore からのスキルインストール | frontmatter の `mode` (`always` / `trigger` / `heartbeat`) と `isPersona` をそのまま取り込む | `mode: heartbeat` でも daemon 全体が無効なら回らない (#967) |
| heartbeat skill の cheapCheck | `cheapCheckCapabilities` 宣言時のみ発動 | 未宣言だと毎 tick AI 呼び出し (§1.2) |

## 11. 同梱スキルの廃止 (#746)

**NoteDeck は skill を同梱しない。** 手元に置かれる skill はすべて MisStore 配布かサイドロード (手書き / AI 生成 / インポート) で、初回起動時に自動で配られるものは無い。

同梱したままだと、修正版を届ける手段がユーザーによる削除・再シードしかなかった。配布に移せばストアの更新検知がそのまま使えるため、同梱シード機構ごと廃止した。

### 11.1 MisStore へ移した skill

| 移管 | skill |
|---|---|
| [#969](https://github.com/notedeck-dev/notedeck/issues/969) | `plugin-author` / `widget-author` / `theme-author` / `skill-author` / `aiscript-author` / `theme-reference` |
| [#746](https://github.com/notedeck-dev/notedeck/issues/746) | `notedeck-guide` / `notedeck-memo` / `self-profile` |

作者系スキルはリファレンスと同じ triggers でセット起動される設計なので、**作者系を入れるときは対応するリファレンスも入れる**（`plugin-author` / `widget-author` → `aiscript-author`、`theme-author` → `theme-reference`）。欠けると生成品質が落ちる。

既に seed 済みのユーザーの手元では、`builtIn: false` + `storeId` 付きのストア配布版相当に変換され、以降はストアから更新できる（削除ではなく変換なのは、本文を書き換えている可能性があるため）。判定は `src/services/storeMovedSkills.ts`。プラグインも同じ形で `src/services/storeMovedPlugins.ts` が担う。

`builtIn` フラグはこの移行判定にだけ残っており、新しく true になる経路は無い。管理カラムの出自分類も「サイドロード」と「ストア配布」の 2 つになった。

### 11.2 テーマだけが例外

テーマ管理カラムには「デフォルト」セクションが残り、既定テーマ (Mi Dark / Mi Light) が並ぶ。これは配布アイテムではなく**アプリが動作するための既定値**。

skill / plugin / query / widget は 0 個でも成立する (無ければ何も起きないだけ) のに対し、**テーマは 0 個が成立しない** — 適用するテーマが無いと画面を描画できず、ストアから取得するまでの間を埋めるものが要る。同じ理由でフォールバック先の base テーマ (props の欠損を埋める、[#1046](https://github.com/notedeck-dev/notedeck/issues/1046)) も本体が持つ。

配布物の「ビルドイン」とは別概念なので、ラベルも「デフォルト」と呼び分ける。削除・編集はできない。

---

## 12. 関連ドキュメント

- [DESIGN.md](DESIGN.md) — NoteDeck の設計判断 / アーキテクチャ
- [DEVELOPMENT.md](DEVELOPMENT.md) — 開発者向けガイド
- [#408](https://github.com/notedeck-dev/notedeck/issues/408) — Capability Registry 設計議論

外部:
- misstore 入門ガイド (近日) — SKILL を書いて配布する手順
- [Anthropic tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)
