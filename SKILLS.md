# SKILLS — NoteDeck AI スキルリファレンス

NoteDeck の AI チャット機能で使う **SKILL (= Markdown 形式の指示書)** を書くための技術リファレンス。

> **入門ガイド・ベストプラクティス例集・配布手順** は misstore 側のドキュメント (近日公開予定) を参照してください。本書は NoteDeck コア仕様に対応する **API リファレンス** に近い性格です。

---

## 1. SKILL とは

- AI チャットの **system prompt に追加されるテキストフラグメント**
- AI の振る舞い・キャラ性・応答ガイドラインを Markdown で記述
- Tauri の `app_data_dir/notedeck/skills/*.md` に置かれる (Linux: `~/.local/share/com.notedeck.desktop/notedeck/skills/`、macOS: `~/Library/Application Support/com.notedeck.desktop/notedeck/skills/`、Windows: `%APPDATA%\com.notedeck.desktop\notedeck\skills\`)
- 複数の SKILL は順に連結されて 1 つの system prompt になる
- misstore で配布可能 (Markdown 1 ファイル単位)

スキルは **AI に "読ませる"** 指示書であり、AI が "実行できる" 機能 (= **capability**) とは別物です。

| | スキル | Capability |
|---|---|---|
| 形式 | Markdown | TypeScript / AiScript コード |
| 役割 | AI への指示 (read-only) | AI が呼べる関数 (tool calling) |
| 配布 | misstore で配布 | builtin (NoteDeck 同梱) or AiScript プラグイン |
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

builtin は **152 個 / 39 subject** (v0.26.0 時点、`src/capabilities/builtins/` 配下の unique id)。subject 別にグループ化:

### 4.0 capability 一覧

| subject | capability ID | 用途 |
|---|---|---|
| **時刻** | `time.now` | ISO 8601 で現在時刻 |
| **アカウント** | `account.current`, `account.list` | 自アカウント / 全アカウント情報 (auth 系 add/switch/logout は塞ぐ) |
| **メタ** | `meta.permissions`, `meta.activeSkills`, `meta.persona`, `meta.config`, `meta.heartbeat` | 自分自身 (AI の権限・skill・persona・config・HEARTBEAT 設定) を内省 |
| **カラム** | `column.list`, `column.active`, `column.add`, `column.remove`, `column.move`, `column.updateSettings`, `column.focusedNote` | デッキカラムの操作 + 並び替え + 設定変更 + フォーカスノート取得 |
| **ノート (read)** | `notes.timeline`, `notes.user`, `notes.search`, `notes.show`, `notes.children` | TL / ユーザー別 / 検索 / 単発取得 / 返信ツリー |
| **ノート (write)** | `notes.create`, `notes.react`, `notes.unreact`, `notes.delete`, `notes.pin`, `notes.unpin` | 投稿・リアクション・解除・削除・プロファイル pin (`notes.write` / `notes.react` permission) |
| **ノート (お気に入り)** | `favorites.add`, `favorites.remove` | お気に入り登録 / 解除 |
| **アンテナ** | `antenna.list`, `antenna.notes` | 自分のアンテナ一覧 + マッチ note |
| **チャネル** | `channel.list`, `channel.notes` | フォロー中チャネル一覧 + note |
| **ロール** | `role.notes` | 指定ロール所属者の note |
| **チャット** | `chat.react`, `chat.unreact` | Misskey 新 Chat API のリアクション操作 (Misskey 専用、registry 同様 adapter 経由しない) |
| **ドラフト** | `drafts.create`, `drafts.update`, `drafts.delete`, `drafts.list` | 下書き CRUD |
| **クリップ** | `clips.list`, `clips.notes`, `clips.create`, `clips.addNote`, `clips.removeNote` | ノートクリップの編集 |
| **通知** | `notifications.list`, `notifications.markRead` | 通知一覧 + 既読化 |
| **ドライブ** | `drive.list` | ファイル一覧 |
| **ユーザー** | `user.lookup`, `user.search`, `user.follow`, `user.unfollow`, `user.followers`, `user.following`, `user.mute`, `user.unmute`, `user.renoteMute`, `user.unrenoteMute` | ユーザー検索 / フォロー操作 / フォロー一覧 / ミュート (block / report は塞ぐ) |
| **リスト** | `list.list`, `list.addUser`, `list.removeUser` | ユーザーリスト編成 |
| **連合** | `federation.chart`, `federation.instances`, `federation.instance` | サーバー連合の統計 + 連合先情報 |
| **アナウンス** | `announcements.list` | サーバーアナウンス read (既読化は塞ぐ) |
| **Pages** | `pages.list`, `pages.show` | Misskey Pages (wiki/長文記事) を情報源化 |
| **Gallery** | `gallery.list` | Misskey Gallery を read |
| **Misskey Play** | `flash.list`, `flash.show` | Misskey Play (AiScript 小アプリ)。`flash.show` は **AiScript ソース含む** |
| **Registry** | `registry.listKeys`, `registry.get`, `registry.set`, `registry.delete` | Misskey サーバー側 KV ストア (Misskey 専用、adapter 経由しない) |
| **メモ** | `memos.list`, `memos.search`, `memos.backlinks`, `memos.create`, `memos.update`, `memos.delete` | AI 永続記憶用ローカルメモ CRUD (#492 #494) |
| **テーマ** | `theme.list`, `theme.read`, `theme.apply`, `theme.create`, `theme.update`, `theme.install`, `theme.uninstall`, `theme.history`, `theme.revert` | per-account テーマ CRUD + 編集履歴 + MisStore install/uninstall |
| **CSS** | `styles.read`, `styles.write`, `styles.append`, `styles.history`, `styles.revert` | カスタム CSS の AI 編集 |
| **スキル** | `skills.list`, `skills.read`, `skills.create`, `skills.append`, `skills.replaceSection`, `skills.toggle`, `skills.install`, `skills.uninstall`, `skills.history`, `skills.revert` | skill 新規作成 (#726) + 自己編集 + MisStore install/uninstall (builtIn 削除はガード) |
| **ウィジェット** | `widgets.list`, `widgets.read`, `widgets.create`, `widgets.update`, `widgets.setAutoRun`, `widgets.delete`, `widgets.install`, `widgets.uninstall`, `widgets.history`, `widgets.revert` | AiScript widget の AI 編集 + MisStore install/uninstall |
| **プラグイン** | `plugins.list`, `plugins.read`, `plugins.create`, `plugins.update`, `plugins.setActive`, `plugins.delete`, `plugins.install`, `plugins.uninstall`, `plugins.history`, `plugins.revert` | AiScript plugin の AI 編集 + MisStore install/uninstall |
| **キーバインド** | `keybinds.list`, `keybinds.set`, `keybinds.reset`, `keybinds.resetAll` | ショートカット編集 |
| **ナビバー** | `navbar.list`, `navbar.set`, `navbar.reset` | サイドバー構成編集 |
| **パフォーマンス** | `performance.list`, `performance.set`, `performance.applySlider`, `performance.reset`, `performance.resetAll` | パフォーマンス設定 |
| **ペルソナ** | `ai.listPersonas`, `ai.setPersona` | AI ペルソナ一覧 / 切替 |
| **AI セッション** | `ai.chat`, `ai.sessions.list`, `ai.sessions.read`, `ai.sessions.search` | プラグインから本体 AI を呼ぶ / 過去セッション参照 |
| **ウィンドウ** | `windows.open`, `windows.close`, `windows.closeAll`, `windows.focus`, `windows.list` | サブウィンドウ操作 |
| **クリップボード** | `clipboard.read`, `clipboard.write` | OS クリップボード入出力 |
| **ストア** | `misstore.search` | MisStore のプラグイン/テーマ検索 |
| **HTTP** | `http.fetch` | 任意の外部 HTTP API (`network.external` permission) |
| **UI** | `ui.notify` | OS / アプリ内通知 |
| **ログ** | `logs.recent` | 直近の AI セッションログ |
| **タスク** | `tasks.run` | 内部タスク実行 |

各 capability の params / 戻り値の詳細は `src/capabilities/builtins/<subject>.ts` の `params` (zod schema) を参照。

### 4.0.1 永久に塞ぐ capability (AI に開放しない)

以下は安全性 / セキュリティ上 AI 開放しない方針:

- `user.block` / `user.unblock` / `user.report` — ブロック / 通報は人手判断必須、AI に委ねない
- `heartbeat.write` (HEARTBEAT daemon 設定変更) — daemon 自己変更で暴走リスク
- `account.add` / `account.switch` / `account.logout` — 認証系操作は AI 不可
- `announcements.read` (既読化) — AI が勝手に既読化して読み逃しを起こすため
- like / unlike 系 (pages / gallery / flash) — 通知が飛ぶ副作用
- plugin install from URL — AI が任意 URL から実行可能になる

### 4.0.2 adapter 経由 / Tauri 直呼び の使い分け

capability は原則 **`ApiAdapter` 経由** (`src/adapters/types.ts` + `src/adapters/misskey/api.ts`) で API を叩く (= フォーク対応の道を残す)。Tauri commands を直接呼ぶのは下記の例外のみ:

- `registry.*` — Misskey 専用の KV ストア API、フォーク差異想定外
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
```

AI には `tool_result` の `content` として文字列化された結果が返される (失敗時はエラー文字列)。

---

## 5. permissions スキーマ

権限は principal (`ai.chat` / `ai.heartbeat` / `plugin` / `external`) 別に `<config dir>/notedeck/permissions.json5` で管理される (#712 で AI 設定から独立ファイルに隔離 — capability からは書き換え不能)。各 principal のプロファイルは `preset` + `custom` で表現:

| preset | readonly | safe | full | custom |
|---|---|---|---|---|
| 読み取り系 (`notes.read` / `account.read` / `drive.read` / `memos.read` / `clips.read` / `drafts.read` / `skills.read` / `widgets.read` / `plugins.read` / `ai.sessions.read` / `logs.read` / `deck.read`) | ✓ | ✓ | ✓ | 個別 |
| 軽い書き込み (`notes.react` / `clips.write` / `drafts.write` / `clipboard` / `notifications` / `tasks.run` / `ai.invoke`) | | ✓ | ✓ | 個別 |
| 自己編集系 (`memos.write` / `skills.write` / `widgets.write` / `plugins.write`) | | ✓ | ✓ | 個別 |
| UI 設定 write (`theme.write` / `styles.write` / `navbar.write` / `keybinds.write` / `performance.write`) | | | ✓ | 個別 |
| 高リスク write (`notes.write` / `account.write` / `drive.write` / `network.external` / `vault.use` / `ai.persona.write`) | | | ✓ | 個別 |

- 全 **34 キー** (`src/permissions/schema.ts` の `PERMISSION_KEYS`)
- capability の `permissions: PermissionKey[]` 宣言と principal の解決値 (`resolveFor(principal)`) を **AND 照合** で評価。不許可なら `permission_denied`
- principal 別デフォルト: `ai.chat` = safe / `ai.heartbeat` = readonly (無人実行は安全側) / `plugin` = safe + `network.external` / `external` = readonly からローカル私的データ read (`memos.read` / `drafts.read` / `skills.read` 等) を落とした縮小 custom
- resolve 時の恒久 clamp (保存値より優先): `skills.write` / `ai.persona.write` / `tasks.run` は plugin / external に恒久 deny (full preset でも拒否)。plugin は `vault.use` も deny。external は Misskey コンテンツ read 4 キー (`notes.read` / `account.read` / `drive.read` / `clips.read`) が常時 ON (トークン発行 = read への同意)
- `custom` プリセットでは個別に on/off
- 自己編集系は `safe` 以上で許可。write 系 capability は全て dispatch 直前の確認ダイアログで enforce される (§5.2)

### 5.1 高リスク権限

`notes.write` / `account.write` / `drive.write` / `network.external` / `vault.use` / `skills.write` / `ai.persona.write` / `memos.write` / `tasks.run` (`HIGH_RISK_PERMISSION_KEYS`) は UI に warning アイコンで表示。dispatch 直前に **確認ダイアログ** で enforce される (引数 JSON は code block + Shiki シンタックスハイライトで表示)。permission 変更は再起動なしで反映 (dispatch 直前に `reloadPermissionsConfig()` で permissions.json5 を再読込 — 外部エディタでの編集も次回 dispatch から効く)。

### 5.2 自己改変系 capability の安全弁

skill / widget / plugin / theme の **書き込み系 capability** (`skills.create|append|replaceSection` / `widgets.create|update|delete` / `plugins.create|update|delete|setActive` / `theme.create|update|revert` 等) は `aiTool: true` で tool calling に露出する (plugin 導入時の `aiTool: false` ガードは #107 で AI 開放に伴い廃止)。現在の安全弁は 3 層:

1. **permission**: `skills.write` / `widgets.write` / `plugins.write` / `theme.write` は preset (`safe` / `full`) か custom で許可されたときだけ通る。#712 以降は principal 別に解決され、`skills.write` / `ai.persona.write` (AI 指示チャネル) は plugin / external principal に対し保存値に関わらず恒久 deny (confused deputy 防止)
2. **確認ダイアログ**: `requiresConfirmation` で dispatch 直前にユーザー承認 (#714 の「今後確認しない」で capability 単位のスキップ可)
3. **capability 個別ガード**: builtIn skill の削除拒否、`skills.create` の frontmatter 遮断 + id 内部生成、`aiscript.validate` preflight 等

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

## 11. Built-in skill

NoteDeck 同梱で初回起動時に seed される skill:

| id | 用途 |
|---|---|
| `notedeck-memo` | `<memos>` ブロックを永続記憶として扱う指示書 (#489) |
| `self-profile` | `skills.replaceSection` で AI が自分のプロフィールを継続更新する自己編集デモ |
| `skill-author` | 会話で見つけたノウハウを `skills.create` でスキル化する作法 (#726) |

---

## 12. 関連ドキュメント

- [DESIGN.md](DESIGN.md) — NoteDeck の設計判断 / アーキテクチャ
- [DEVELOPMENT.md](DEVELOPMENT.md) — 開発者向けガイド
- [#408](https://github.com/hitalin/notedeck/issues/408) — Capability Registry 設計議論

外部:
- misstore 入門ガイド (近日) — SKILL を書いて配布する手順
- [Anthropic tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)
