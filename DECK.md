# DECK — デッキと画面の設計

ウィンドウとカラム、プロファイル、ノートの一覧、カラムクエリ、配布物、テーマ、ゲストとログアウト後の表示など、デッキの画面に関わる設計の解説。
全体のデータの流れは [ARCHITECTURE.md](ARCHITECTURE.md)、UI の判断基準は [DESIGN.md](DESIGN.md)、どこに何があるかは [CODEMAP.md](CODEMAP.md) にある。

---

## Window / Column Model（[#194](https://github.com/notedeck-dev/notedeck/issues/194)）

ウィンドウとカラムは「ストリーム / 詳細 / ツール」の3分類で役割を分担する。

| 分類 | UI | 用途 | 永続性 |
|------|-----|------|--------|
| **ストリーム** | カラム | 継続的なデータフィード（TL、通知、検索、チャット等） | プロファイルに永続化 |
| **IDE ツール** | カラム | 開発・デバッグ支援（Stream Inspector 等）、MFM エディター（デッキと同じ `MkMfm` で確かめながら書き、投稿フォームへ送る。本文はカラム設定 `mfmText`）、ローカル PKM（メモ — `data/memos/*.md` を Obsidian vault としても開ける。サーバーへ送らずローカルで完結し、同じくアカウントなしの AI カラムから参照されるため **アカウントに紐づかない**（#1018）。他のテキストと同じ編集履歴を持つ） | プロファイルに永続化 |
| **詳細** | ウィンドウ | 特定アイテムの一時的な表示（ノート詳細、プロフィール、フォローリスト） | セッション限り |
| **インスペクタ** | ウィンドウ | Raw JSON 表示・デバッグ（ノート/通知インスペクタ、settings.json5 エディタ） | セッション限り |
| **ツール** | ウィンドウ | アプリ設定・管理（ログイン、エディタ群、プラグイン、about） | セッション限り |

**OS の窓の種類と役（[#1131](https://github.com/notedeck-dev/notedeck/issues/1131)）:**

役はプロセスが持ち、窓は持たない。プロセスに 1 つの仕事（トレイ / OS バッジ / 更新確認 / HEARTBEAT の構成 / 通知クリックと deep link の遷移 / 外部からの問い合わせへの応答 / 設定ファイルの移行 / プラグインの無人の副作用）は Rust が所有し、WebView が無いとできない仕事は Rust が選んだ**代表窓**に任せる。VS Code の「UI を持たない main プロセス + 対等なワークベンチ窓」と同じ形。label `main` に残る意味は「起動時に Tauri が作る窓」「window-state プラグインの保存対象」の 2 つだけ。代表窓は利用者向けの語ではないので UI 文言と GLOSSARY に出さない。

| 窓 | label と URL | 親 | 永続化 | 生成数の上限 |
|---|---|---|---|---|
| **デッキ窓**（起動時の窓と、利用者が開くミラー。デッキ全体を描き、対等） | `main` / `deck-*` + `?profile=` | 無し | main は window-state プラグイン、ミラーは非永続 | ミラーだけ数える |
| **ポップアウト**（カラム群を切り出した子。デッキの画面で描く） | `deck-*` + `?profile=&window=<id>`（id はプロファイルの `windows[].id`） | デッキ窓 | プロファイルの `windows[]` | 数える |
| **PiP**（カラム 1 本かウィンドウ内容 1 つ） | `pip-*` + `/pip` | デッキ画面を描く窓か PiP | 非永続 | 数える |

- **窓を作るのは Rust**（`sub_window_create`、`src-tauri/src/commands/sub_window.rs`）。URL と label は Rust が組む。ポップアウトの label はプロファイルの `windows[].id` と一致させる必要があるので JS が渡すが、Rust が形式を検証し `main` / `pip-*` は名乗れない。kind ごとの呼び元（ポップアウト / ミラーを頼めるのはデッキ窓だけ）も Rust が検査する。capability から窓生成の権限は外してあり、`new WebviewWindow` と `'/pip'` の比較と label `'main'` の比較の出現ゼロを lint（`tests/lint/windowRoles.test.ts`）で検査する。名簿（`window_registry.rs`）は Tauri 非依存の純 struct で、親子・上限・CloseRequested の印を持ち、効果を値で返す。窓のイベント（CloseRequested / Destroyed / Focused / Moved / Resized）は `window_events.rs` の dispatcher に集める
- **代表窓**は参照時に計算する（`main` が居ればそれ、無ければ最も古いデッキ窓）。claim / grant のリースは不採用（リロードや WebProcess の再起動で役が死ぬ）。JS は `useRepresentative()` の `isRepresentative` で判定し、代表窓だけが持つ仕事（HEARTBEAT の表示 / OS バッジ / トレイ）は `<RepresentativeDuties>` が mount する。起動時の 1 回限りの仕事（ファイル移行 / seed）は `isRepresentativeNow()`
- **見ている窓** = 最後にフォーカスされたデッキ窓。通知クリック / deep link / 単一インスタンス起動 / グローバルホットキーの前面化と、窓ごとに値が違う問い（`deck/active`）・確認ダイアログを出し得る問いの答え手。トレイの左クリックと「表示」だけは `main` の表示切替のまま（トレイは `main` を隠す操作の対）
- **宛先付きイベント**: 1 窓だけが処理するもの（deep link / 通知クリック / トレイの切替 / 外部からの問い合わせ / 子窓からの知らせ）は `to` を持つ struct を全窓へ流し、受けた窓は `listenAddressed`（`src/utils/addressedEvents.ts`）で自分宛て以外を捨てる。`emit_to` は `Any` 購読が残ると漏れるので使わない。デッキ窓がまだ無い冷えた起動の遷移は Rust が預かり（`pending_inbox.rs`）、最初の名乗りで流す
- **親子・回収・上限**: 子が閉じたら Rust が親（居なければ代表窓）宛てに `ChildClosed { reason }` を流す。reason は Rust が決める（その窓で CloseRequested を見れば `user`、見なければ `lost`。JS に「閉じる前に告げる」口は無い）。カラムの回収（`recallColumnsFromWindow`）は `user` だけで、`lost` は回収せず次回起動で開き直す。プロファイル切替の一括クローズは `sub_window_close` の `destroy()`（lost）、「すべてのウィンドウを閉じる」は `close()`（user）。上限は Rust の定数 `MAX_SUB_WINDOWS` で設定項目にしない。自動の経路（起動時 / プロファイル切替の復元）は拒んで受信トレイに残し、人の操作は開いた上で枚数を警告する（人の操作は止めない）。デッキ窓が 0 になれば残る子も終わり、アプリは終了する（トレイ無し環境で PiP だけ残す使い方は支えない）。子窓にも起動フューズがあり、mount に失敗して不可視のまま残った窓は Rust が show する
- **クエリ購読の所有者**: `QueryRuntime` は購読を窓の label 別に数え、コマンド表の `(owner = window)` 属性で呼び元の label を本体に渡す。窓が消えたら Rust が `close_owner` でその窓の分だけ閉じる（JS の unmount と二重になっても組が無ければ無視）
- **表示と復元の規則**: `windowLayout` はデッキ窓では「windowId 無し」か「その窓が開いておらず復元待ちでもない」カラムを描き、後者はヘッダーに「別ウィンドウのカラム」のボタン（押すと開き直す）とメニューの「このウィンドウに戻す」を出す。保存は触らない。名簿の写し `liveWindowIds` は Rust の `SubWindowsChanged` で届き、未取得の間は windowId 付きを描かない。起動時は代表窓が `windows[]` のうちカラムのある窓を自動で開き直す（VS Code の `window.restoreWindows` と同じ。この機能を含む版への更新後の初回だけは開かずバッジで出す）。`windows[]` に無い窓のカラムは起動時に回収する。プロファイル切替は呼んだ窓とその子だけが対象で、アクティブプロファイルの保存は全窓共有（ミラーで切り替えると次回起動のプロファイルも変わる）。プロファイルの同時編集（デッキ窓 ↔ ミラー / ポップアウト）は last-writer-wins で保証しない
- **プラグイン**: `launchAllPlugins` はデッキ窓とポップアウトで走り、PiP では起こさない（ノート表示フックは PiP で効かない）。`Nd:on` の配送と、起動時の top-level から呼ばれた UI（`Mk:dialog` / `Mk:confirm` / `Mk:toast`）は代表窓だけ（`uiAllowed`）。UI 起点の hook の中は窓を問わない。PiP の中からの capability `windows.open` は Err
- **採用しなかったもの**: ポップアウト専用画面（`/popout`。ROADMAP が謳うモニター 2 での操作を削る）/ 別の端末やサーバーの notemaid に繋ぐ構成 / ポップアウトの最大化保存（モバイルサイズ表示が用途）/ リースの状態機械 / プロファイルファイルの書き手 1 本化（別 issue）/ 「メインが消えたらサブウィンドウも落とす」規則（ミラーは子ではなく対等）

**ウィンドウのジオメトリ永続化（[#874](https://github.com/notedeck-dev/notedeck/issues/874)）:**

位置・サイズの保存と復元は、ウィンドウの種類ごとに要件が違うので**機構を分けたまま統合しない**。「同じ仕事の二重実装」ではなく、グローバル vs per-profile、描画前復元 vs プロファイル適用時復元という要件差から来ている。

| ウィンドウ | 保存先 | 復元 | 内容 |
|---|---|---|---|
| **main** | `tauri-plugin-window-state`（Rust 側、ラベル → ジオメトリのグローバル map。`src-tauri/src/lib.rs`） | 初回描画前。クラッシュやトレイからの Quit でも保存される | サイズ・位置・最大化・フルスクリーン。可視状態は除外（close → トレイ hide → Quit で不可視が保存されると次回起動が見えなくなる）、装飾も除外（`decorations: false` 固定） |
| **デッキ派生**（カラムのポップアウト。`?profile=&window=<id>`） | プロファイルの状態 `state/deck/<profile id>.json5` の `windows[]`（per-profile。Rust が子窓の Moved / Resized を論理 px で記録し、debounce して親の窓に `ChildGeometry` で届ける。親が `saveWindowLayout` でプロファイルに書き、保存時に設定側と分ける。#1131 / #1333） | プロファイル適用時に、カラムが割り当てられているものだけ開き直す。保存モニタが無ければ primary の中央、はみ出していれば境界に clamp | 位置・サイズ・モニタ名。最大化状態は持たない（現状） |
| **ミラー**（`?profile=` のみ、windowId なし）/ **PiP**（`pip-<時刻>-<連番>`） | 非永続 | 都度、既定サイズで開く | — |

- **Rust プラグインに寄せない理由**: 派生ウィンドウのジオメトリはプロファイル切替でウィンドウ構成ごと復元される per-profile データで、プラグインのグローバル map にはプロファイルを載せる場所がない。どのウィンドウを作るかはアプリロジックなので、生成時にジオメトリを渡す現行の形が最も atomic。ジオメトリはこの機械の状態なので持ち出す単位 (プロファイル) には書かず、`state/deck/` に対の `columns[].windowId` と一緒に置く (片方だけ動かすとポップアウトカラムが復元不能扱いになる。#1333 §3)。メモリ上のプロファイルは両方を重ねた形で、保存は変わった側だけ書く
- **フロント側に寄せない理由**: 描画前の復元とクラッシュ時・トレイ Quit 時の保存は Rust 側でフックしているから成立している。フロントに移すと復元は JS ブート後（見えてから跳ぶ）になり、プラグインが解決済みのクロスプラットフォームの罠を再実装することになる。派生ウィンドウの保存点も同じ理由で Rust 側の窓イベント（`window_events.rs`）にあり、フロントの beforeunload には頼らない
- **動的ラベルのウィンドウをプラグインの対象から外す理由**: 復元先が二度と一致せず、state ファイルにゴミが溜まり続ける。ラベルを安定化しても、プロファイル削除時に同じ問題が形を変えて再発する
- どちらも他方の上位互換ではない。プラグインは現存モニタと交差しなければ OS に配置を任せるオフスクリーンガードと最大化・フルスクリーンを持ち、フロント側はモニタ名一致・境界 clamp・primary 中央寄せ・論理 px 正規化を持つ

**Cross-account カラム:**

カラムのアカウントスコープは 3 状態ある。`accountId` は `string | null` のままで、`null` の意味は registry の `crossAccount` 宣言から引き直す（#1018）。

| スコープ | 条件 | 動作 |
|---------|------|------|
| **per-account** | `accountId` あり | `useColumnSetup` で単一アダプタ |
| **全アカウント** | `accountId: null` + `crossAccount: true` | `useMultiAccountAdapters` で全アカウント並列取得。サーバーに閉じた ID を選ぶ面 (リスト / アンテナ / クリップ / チャンネル / ロール / ユーザー) は `sources` (アカウント + ID の組の配列) を並列取得 ([#1017](https://github.com/notedeck-dev/notedeck/issues/1017) 案 2) |
| **アカウントなし** | `accountId: null` + `crossAccount` 宣言なし | アカウントに紐づかない（AI・スキル・タスク等） |

判定は `src/columns/accountScope.ts` の `getAccountScope()` 一本。「全アカウント」で開けない理由（サーバー単位の面 / 未対応）も同じファイルの `crossAccountUnavailableReason()` で導き、カラム追加ダイアログは行を消す代わりに無効の行と理由を出す（[#1017](https://github.com/notedeck-dev/notedeck/issues/1017)）。カラムを受け取る側が「束ねるべき」か「関係ない」かを各自で判定すると、対応種別が増えるたびに虫食いが再発するため、この 1 箇所を経由する。対応種別の正本は `src/columns/registry.ts` の `crossAccount` 宣言。

サーバーに閉じた ID を選ぶ面の「全アカウント」は **アカウントごとに選んで束ねる** (#1017 案 2)。カラムは `accountId: null` と `sources: { accountId, id, name? }[]` (`src/services/columnSource.ts`) を持ち、追加ダイアログでアカウントごとに項目を複数選ぶ。`name` は表示用の写しで同一性には使わない (名前は ID にならない、#1058 と同じ理由)。取得・遡り・購読は組 (`sourceKey` = アカウント + リソース ID) ごとで、`useCrossAccountNotes` の `sources` に渡す。全アカウントを 1 回ずつ回す面は ID が空の組として同じ経路に乗る。アカウントを削除したらその組だけを外し、カラムは残す。表示は 6 種で共通の `DeckCrossSourcesColumn` で、組込フィルタとカラムクエリは全アカウント TL と同じ評価器で効く。per-account の操作 (名前変更 / 削除 / チャンネルの投稿フォーム) は全アカウント面では出さない。コマンドパレットからも同じ流れ (アカウント → 項目を選ぶとアカウント一覧に戻り、「N 件で追加」で確定) で作れる。

全アカウントのカラムはヘッダーにアカウントの顔を並べず `ti-user` アイコンを 1 つ出す（アカウントなしは何も出ない）。そこからアカウント必須の操作を始めるときは `useAccountPicker` でどのアカウントで実行するかを選ばせる。「アクティブアカウント」という概念は持たない（[#941](https://github.com/notedeck-dev/notedeck/issues/941)）: 実態は登録順の先頭でユーザーが選んだものではなかったので、UI・capability・スラッシュコマンドのどこでも暗黙にフォールバックしない。capability は「明示の `accountId` → 呼び出し文脈のアカウント（per-account の AI カラム、ノートメニューから起動したプラグイン）」の順で解決し、どちらも無ければ `accountId` を必須にする。文脈が無いときの UI の初期値（投稿フォームの宛先、メモの絵文字辞書）だけ `accountsStore.fallbackAccount`（トークンを持つ先頭）を使い、これを「現在のアカウント」として見せない。

**同一ノートの束ね（[#1058](https://github.com/notedeck-dev/notedeck/issues/1058)）:**

複数サーバー（複数アカウント）で観測した同じノートは、全アカウント面では別々の行として並べず 1 つの group に束ねる。設計の正本は #1058 の設計コメント。要点だけ書く。

- **キーは 2 つ**。行の一意性は「取得元アカウント + ノート ID」の複合（`VariantKey`、`src/services/noteKey.ts`）。ノート ID はサーバー内でしか一意でないので、ID 単独をキーにする箇所は残さない。同一性は正規化した ActivityPub object id（`NormalizedNote._identity`）で、導出と origin 判定・整合検査は notecli 側で行い、TS は値を読むだけ
- **束ねはカラム単位**。`useNoteList({ bundle: true })` がそのカラムの順序配列を identity で畳み、`groups` を表示単位として返す。ストアは variant 単位のままで identity の索引は持たない（他カラムの取得で表示が揺れないように）。純関数は `src/services/noteGroup.ts`
- **主ビュー**は静的な事実だけで選ぶ（公開範囲の階級 → トークン → 本文の有無 → 埋め込みの健全性 → 凍結 → 投稿者一致 → origin → 更新時刻 → アカウント順）。反応数や取得順では選ばない。数（reactions / renoteCount / repliesCount）は主ビューの値をそのまま使い、合算も max もしない（Like は origin と反応者のフォロワー先の両方に配送されるので足すと二重計上）
- **可視性**はユーザー意思（ミュート）を variant の OR で、サーバー判断（削除・凍結）を対象ノート自身の origin で下されたときだけ権威として扱う
- **採用しない**: public 階級で origin の variant が本文非公開（投稿者の「古いノートを隠す」設定）でも、それをトークンの有無より優先しない。中身は連合先に届いていてユーザーはそこで読めるので露出は広がらず、guest の origin を主にするとログイン済みアカウントが本文を持っているのに伏せ字を見せて操作もできなくなる。origin にもログインしていれば既存の順位で origin が主になる（2026-09 の PR #1092 レビューで検討）
- **Note Capture の予算**（`noteCaptureMax`）は実際の購読数で数える（本体 + Renote 元、`src/services/captureBudget.ts`）。per-account / 全アカウントの両実装で共通
- **操作の宛先**: ノート文脈のある操作（返信・リアクション・Renote・引用）の既定は主ビューの取得元アカウント。per-account 面で「そのノートを取得したアカウント」が既定なのと同じ規則で、上の `useAccountPicker` の規則はノート文脈の無い操作（新規投稿）に適用する。トグルは「押したら主ビューの状態が反転」の 1 本。他アカウントの反応の取り消しはノートメニュー「別のアカウントで…」から。実装は `useColumnSetup` の `handlers.*` に一本化してあり、カラム adapter が無い全アカウント面ではノートの `_accountId` で adapter を解決する（未ログインなら toast で止め、無言 no-op にしない）。投稿フォームは `ColumnCrossPostForm` が `postForm.accountId`（操作したノートの取得元）宛てに描画する。全アカウント面のカラムで `handlers.*` を迂回して自前の操作関数を書かない。ノートを noteStore に置かない面は保持形態に合わせて追従する — ルックアップは `applyNotePatch` オプションで deep ref に差分を当て、削除済みキーを手元に持って再マージから除外する。通知は `setOnNotesMutated` で store の最新へ差し替え、`noteStore.onDelete` の購読で削除を落とす
- **全アカウントのユーザー照会** ([#1185](https://github.com/notedeck-dev/notedeck/issues/1185)): 解決できたアカウントごとに 1 行 (そのアカウントの文脈でクリック / ホバー / フォロー)。アバターの右上に取得元アカウントのサーバーアイコンを出して「どのアカウント経由か」を示す (右上のバッジはサーバーのアイコンだけ)。acct で束ねない (同じ人の行が N 本並ぶのを許す。カード + 行の二段は冗長だったので不採用)。分解と正規化は `src/services/userRef.ts` に 1 本 (検索の投稿者条件も同じ正規化)。自サーバーの acct には `host` を渡さない (渡すと「見つからない」が「解決できない」に包まれる)。失敗はサーバーが区別する 2 種 (見つからない / 解決できない) + その他で、「見つからない」は件数だけに畳む。相手サーバーに残る痕跡は [SECURITY.md](SECURITY.md) の受け入れ済みリスク
- **ライブ更新（全アカウント TL / メンション、[#1059](https://github.com/notedeck-dev/notedeck/issues/1059)）**: `useCrossAccountNotes` がアカウントごとに購読し、新着は 1 つの `useStreamingBatch` に合流させる。同じ identity の group が既に列にある variant は行を増やさず既存 group の直後に差し込む（サイレント挿入）。新着バナーの数は variant 数でなく増える行数。復帰時の catch-up はアカウントごとに `hasGap`（`src/services/timelineGap.ts`）を評価し、欠落したアカウントの variant だけを置換する（他アカウントの行は消さない）。全アカウント TL の対象はホームとグローバルだけ（ローカルと、ローカルを含むソーシャルは「そのサーバーの民」の性質が強い。グローバルは各サーバーから見た連合全体なので跨いでも意味が通り、束ねの効果も一番出る）
- **段階表示（[#1095](https://github.com/notedeck-dev/notedeck/issues/1095)）**: 全アカウント面の取得は `mapWithConcurrency` の `onSettled`（完了順・直列）で返ったアカウントの分から扱い、待っている間は `CrossAccountProgress`（「N アカウントのうち M 件待ち」）を出す。規則は面で分ける。**TL / メンション / 通知の初回**は「何も出ていなければ最初に返った分で描画し、既に何か（キャッシュ・先に返った分）が出ていれば全部揃ってから 1 回で並べ直す」— 速い分を先に出すと後から上に差し込まれて画面が動くので、動くのを最大 1 回に抑える。**追加読み込み**は、水平線で揃える面 (TL / メンション / 通知、下の #1184) では底を決めているアカウントだけ 1 ページ取り、それ以外の面 (お気に入り等) は全面で到着順に足す。**サーバー検索**は初回から到着順（速い分から出して困らない面）。照会は以前から同じ方式。HTTP タイムアウトは notecli 共通の 30 秒のまま — 段階表示にした以上、遅い 1 件が他を止めないので短い見切りは入れていない
- **下端は水平線で揃える（[#1184](https://github.com/notedeck-dev/notedeck/issues/1184)）**: 全アカウント TL / メンション / 通知は複数アカウントの時系列を 1 本に合流させる処理なので、列の底は「まだ遡れるアカウントのうち到達点がいちばん浅いもの」(水平線) で揃え、それより古い行は列に載せたまま表示に出さない (`useNoteList` の `displayFloor`。隠れた行は上限に数えず、落とさない)。到達点は取得単位 (アカウント、組を束ねる面では組) 別のカーソル (`src/services/crossAccountPaging.ts`、取得した生ページの最古で単調前進。列の行から取ると切り詰めで位置を失い、最新ページを取り直す往復になる) で持ち、追加読み込みは水平線を決めているアカウントだけ 1 ページ取る。空ページで尽きたアカウントは水平線から外れ、全部尽きたら制限なし。失敗したアカウントはバックオフし、その間は追加読み込みが何も取らない — 失敗中も水平線から外さない (外すと復帰後のページが既表示行の間に差し込まれ、塊が挟まる症状が再発する)。水平線は接続中は単調に下がるだけで、復帰の gap 置換で上げない (1 アカウントの gap で他アカウントの表示行を消さない)。末尾に区切り行 (`CrossAccountEndMarker`) を、隠れている行か取得できていないアカウントがあるときだけ出す。**疎アカウントの過去を深く読む用途は per-account カラムが担う** (各アカウントを同じ深さまで遡ることは目標にしない)。お気に入りのように並びが createdAt でない面は水平線を使わない (`paging` 未指定) が、遡りの位置は同じく生ページのカーソルで持つ。お気に入りの untilId はノート ID ではなくお気に入り ID (本家は NoteFavorite の id で解く。notecli が `_favoriteId` で持ち回り、`cursorOf` でページ末尾の行から取る)。通知カラムは `useNoteList` に載っていないので、同じカーソルと水平線を `notificationMerge` の `floor` / `trim` で自前に当てる (per-account の追加読み込みも「新しい側を捨てる」でなければ、上限に達した時点で足した分が即消えて同じページを取り直し続ける)
- **フィルタメニュー**: 全アカウント TL でも per-account と同じ組込トグルとクエリトグルが効く。評価器は `useColumnQuery` を per-account (`useNoteColumn`) と共有し、キャッシュ / 初回 / 追加読み込み / 復帰 / streaming の全経路で組込 → クエリの順に AND 合成する。復帰の取り直しでは既存行も判定を通し、切断中の編集で合致しなくなった行は表示から外す（本文編集にはライブイベントが無く、取り直しが唯一の回収経路。[#1120](https://github.com/notedeck-dev/notedeck/issues/1120)、per-account も同じ）。組込フィルタの候補はログイン中の全サーバーが対応するキーだけ（片方だけ対応するキーを出すと効くサーバーと効かないサーバーが混ざる）、API 側パラメータは per-account と同じ。フィルタ変更は全アカウント取り直し。クエリの候補は全体スコープのみ（全アカウント面は accountId を持たない）。バッジ・フィルタボタン・バナーは `ColumnQueryBadge` / `ColumnFilterButton` / `ColumnQueryBanners` を両面で共有する
- **基準サーバーの絶対化**: Misskey の API は取得元サーバーのローカルユーザーを `host: null` で返し、ティッカーもリモートにしか付けない。全アカウント面では行ごとに基準が変わって不自然なので、全アカウント面のカラムは `provideNoteFrame(isCrossAccount)` を宣言し、`MkNote` はローカルユーザーにも取得元（`_serverHost`）を補って `@user@server` とティッカーを全員に出す（規則は `src/services/noteFrame.ts`）。per-account 面は本家どおり相対表示のまま
- **クライアント検索（[#945](https://github.com/notedeck-dev/notedeck/issues/945) / [#958](https://github.com/notedeck-dev/notedeck/issues/958)）**: 手元のキャッシュ（SQLite）をサーバー・アカウント横断で引く `clientSearch` 種別。既存の「サーバー検索」（`search` 種別、Misskey の notes/search）とは並立する別の面で、置き換えではない。アカウントに紐づかず（`accountIndependent`）ログアウト中でも動く。経路は notecli の `search_cached_notes_across`（検索語・期間・投稿者 `name@host`・添付の有無）を `apiSearchNotesCachedAcross` で呼び、結果は `useNoteList({ bundle: true })` で束ねて基準サーバーを絶対表示にする。検索語と絞り込みはカラムに永続化するので、条件を置いたまま常設できる（#958 の段階 2）。絞り込みの純ロジックはサーバー検索と共通の `src/services/searchFilter.ts`（次項）。AI からは `notes.searchArchive` capability で同じ経路を引ける（[#947](https://github.com/notedeck-dev/notedeck/issues/947)）。索引にはフォロワー限定・ダイレクトも入るので権限は `notes.read` と分けた `notes.readArchive`（readonly / safe では閉じ、full だけ開く。external の既定 custom でも落とす）にし、公開範囲は既定で public のみ（`includePrivate` で明示）。チャットは対象外（#951）
- **クライアント検索へのカラムクエリ適用（[#1178](https://github.com/notedeck-dev/notedeck/issues/1178)）**: クエリ (#783) はノートカラムと同じ縫い目 `useColumnQuery` で、索引から返ったページを列に入れる前に判定する（意味論・バッジ・バナー・fail-closed / fail-open・サスペンドと再開はタイムラインと同じ。streaming は無いので `enqueue` は空、「再開」とクエリ変更の `refresh` は同じ条件での検索のやり直し）。**検索を始める規則は 1 本**（`src/services/searchRun.ts` の `shouldStartSearch`）: 検索語 / フィルターの行 / 本文の条件 / 条件に数えるクエリ のいずれかがあれば検索し、無ければ案内に戻す（索引全件は出さない）。fail-open で「無いもの」になったクエリ（セーフモード / 全無効）は条件に数えない — クエリだけを条件にしたカラムがセーフモードで索引全件（DM 込み）のダンプに退化しないため。fail-closed（解釈不能 / 参照消失 / サスペンド）は数えて検索を始め、最初のページで保留に止める。**ページ位置と続きの判定はクエリを当てる前の生ページ**で持つ。追加読み込みの引き金はスクロールだけなので、結果の末尾（0 件なら空状態の CTA）に「続きを読む」を常設し、明示の操作（Enter / 続きを読む / スクロール / フィルターとクエリの切替）で始まった走査だけ「一画面に満たない間、または直前のページで 1 件も足せなかった間」自動で続ける（`decideContinue`、走査件数の上限はタイムラインの索引検索と揃えない。描画後に測る）。入力中のデバウンス検索と起動時の復元は最初のページで止める。クエリが止まっている間は続けない。除外した件数は結果の末尾に出す（検索 1 回分で累積、評価器の件数ではなく自分で数える — クエリ変更時の表示中への再判定を二重に数えないため）。空状態は 条件なし / クエリは適用しているが条件に数えていない（理由つき）/ 保留 / 全件除外（N 件）/ 結果なし を分ける。サーバー検索へのクエリ適用は不採用（理由は #1178 本文）
- **検索カラムの絞り込みは 1 つのパネルと 1 つの条件モデル（[#1180](https://github.com/notedeck-dev/notedeck/issues/1180)）**: サーバー検索とクライアント検索は並立する別の面のままだが、絞り込みの UI と条件モデル（`DeckColumn.searchFilter`、`src/services/searchFilter.ts`）と語彙は共有する。絞り込みの UI はノートカラムのフィルターメニューそのもの（`ColumnFilterButton` → `TimelineFilterPopup`）で、検索の行（`SearchFilterPanel`）を `extra` スロットで差し込む。別の容器を作らないので、カラムクエリのトグルも同じポップアップに載る（クライアント検索は #1178 で評価経路を繋いだので出す。サーバー検索は評価経路を持たないので `hideQueries` で出さない）。行（範囲 / 投稿者 / 期間 / 添付 / 本文の条件）は面が `FACE_ROWS` で宣言したものだけ出し、パネルに面の分岐を書かない。ノートカラムの組込トグル（`filterKeys`）も同じメニューに出す（サーバー検索は 返信 / Bot / センシティブ、クライアント検索は リノート / 返信 / Bot / センシティブ。添付はフィルターの行にある。評価は返ったページへの手元判定で、検索を始める条件にも数える）。面に意味の無い行に値が残っていれば（サイドバーの差し替えなど）黙って無視せず「効かない」と見せて外せる。**同じ行でも意味が違うものは別の鍵に保存して読み替えない**: 範囲はクライアント検索が索引のサーバー / アカウント（`scope`）、サーバー検索が返すノートのホスト（`host`、`.` = ローカル。選択肢はサーバーの `noteSearchableScope` と連合の有無で出し分け、設定の無いサーバーはローカルだけ。指定ホストが問い合わせ先自身ならローカルに読み替える）。投稿者は `name@host` の表記を正本に、サーバー検索は確定時にだけ解決してアカウントごとの ID を `authorIds` に持ち、表記が変わるまで解決し直さない（未解決は見せて、そのアカウントでは検索しない。全アカウント面は各アカウントで解決し、解決できたアカウントだけに投げる。範囲の選択肢は各サーバーの和集合 `unionHostOptions` で、「すべて」「ホスト指定」を出せないサーバーには投げない `hostPlanForAccount`。投げなかったアカウント数は 0 件と見分けるために検索バーの下に出す、#1182）。並び順はクライアント検索が索引の走査方向、サーバー検索が取得済みページの並べ替え。**検索語の欄は母集合を取る正の語、条件ビルダー（`ConditionBuilder`、フィルターパネルの 1 行として埋め込む。別ボタンにしない）はそれに加える条件**で、構造（いずれかを含む / すべてを含む / 除外する）を正本として保存し、クライアント検索は索引の条件（`text_any` は「いずれか」の行ごとの OR 群を AND する `Vec<Vec<String>>`、`text_all` / `text_exclude` は語の列）に直接、サーバー検索は返ったページの手元照合（`matchesTextConditions`、単一語のリテラル含有 `matchesPlainTerm` も同じ 1 層）に落とす。正規表現モードは廃止した（構造の条件が任意 / 全部 / 除外を賄い、正規表現が足すのはパターン照合だけで、暴走対策の Worker まで抱える価値が無い。2026-10-04）。索引側の条件は本文だけを見る（索引が本文だけで、CW まで見ると全文検索の絞り込みが効かず全走査になる。サーバー検索の手元照合は本文 + CW で、この差は受け入れる。#1182）。`workerClient` の `timeoutMs` は残る。欄への手入力以外（ハッシュタグ / CLI / AI の `column.updateSettings`）からの検索語の差し替えは `externalQueryPatch` で期間と範囲を消し、本文の条件は消さずに止める（`conditionsPaused`、パネルの行の中に印が出て、本人が条件を触るか検索語を手で打てば戻る。投稿者と並び順は残す）。「フィルターをクリア」はパネルの行（本文の条件を含む）を消し、並び順は残す。AI の capability が書けるのは検索語だけで、条件モデルは書けない。旧 `clientSearchFilter` と検索カラムの `userId` はプロファイル読込時に一度きり移行して書き戻す（`migrateSearchColumns`）。揃えない部分は検索の開始（サーバー検索は Enter で確定、クライアント検索は入力のたび。実行ボタンは置かない）と添付の行（サーバーの検索 API に無い）
- **UI**: `MkNote` の `group` prop。主ビュー以外のアカウントだけが押している反応は破線の副スタイル + アバター、主ビューに無い反応は数字なしの合成チップ。ヘッダーのバッジ（アイコン + 数）で内訳（どのアカウントで見えているか・どれが主か）を開く。内訳にサーバー別の数字は出さない。開発者モードの Raw JSON インスペクタで variant を切り替えられる

**ナビバー（VSCode Activity Bar 式）:**

左ナビバーのアイコンはカラムの**トグルボタン**として機能する。クリックでサイドバーカラムを左端（`layout[0]`）に挿入、再クリックで削除。同時に1スロットのみ（`sidebar: true` フラグで管理）。

ナビバーのボタン構成はカスタマイズ可能（設定 → ナビバー）。`NavItem = { type, accountId } | { type: 'divider' }` 構造体でプロファイルに永続化される。

**共通コンポーネント:**

| コンポーネント | 用途 | 使用箇所 |
|-------------|------|---------|
| `ColumnBadges` | サーバー/アカウントバッジ表示 | DeckNavbar, DeckBottomBar, DeckMobileNav |
| `AccountAvatar` | アカウントのアバター + 右上のサーバーバッジ | DeckColumn（カラムヘッダー）, AddColumnDialog, CommandPalette 等 |
| `EditorTabs` | ビジュアル/コード 2タブ切替（コードタブはデフォルト値との差分のみ表示） | 全エディタ系ウィンドウ共通 |
| `RawJsonView` | Raw JSON 表示（機密マスキング・コピー対応） | NoteInspectorContent, NotificationInspectorContent, UserProfileContent |

**共通 composable:**

| composable | 用途 | 使用箇所 |
|-----------|------|---------|
| `usePointerReorder` | Pointer イベントによるドラッグ&ドロップ並び替え（軸指定対応） | NavEditorContent, ProfileEditorContent |
| `useCrossAccountNotes` | 複数アカウントからのノート並列取得・統合・重複排除 | DeckMentionsColumn, DeckTimelineColumn, DeckFavoritesColumn |
| `useVerticalResize` | 上下分割ペインのドラッグリサイズ（高さ制限付き） | DeckStreamInspectorColumn, DeckAiScriptColumn |
| `useSensitiveMask` | 機密フィールドのマスキング表示・トグル reveal | NoteInspectorContent, NotificationInspectorContent, UserProfileContent |

**アイコン・ラベルの一元定義:**

`src/columns/registry.ts` の `COLUMN_ICONS` / `COLUMN_LABELS` がカラムタイプのアイコンとラベルの SSoT。ナビバー、ボトムバー、エディタすべてがこれを参照する。

## Multi-Window & Profile Architecture

ウィンドウとプロファイルは**直交する概念**です。

- **プロファイル**: カラム構成・レイアウトの保存単位。データの所有者
- **ウィンドウ**: プロファイルの表示先。同じプロファイルを複数ウィンドウで開ける

```
Profile A ──→ デッキ窓（windowId なしのカラムを表示。起動時の窓 `main` とミラーは対等）
         └──→ ポップアウト "w1"（windowId = "w1" のカラムを表示。デッキ窓の子）

Profile B ──→ デッキ窓（プロファイル切り替え時）
```

**設計原則:**

1. プロファイルが変更されたら、そのプロファイルを開いている**全ウィンドウ**がリアクティブに追従する
2. 各ウィンドウは `windowLayout`（computed）で自分に属するカラムだけをフィルタして表示する
3. ウィンドウの作成・破棄はプロファイルのデータに影響しない

**同期方式:** 永続化の正本はプロファイルフォルダ配下のファイル（#913。ID とファイル名の対応表つき）で、Tauri 実行時はこれが唯一の置き場。起動時は Vue の初回描画前にファイルを読み終える（`main.ts` が `preloadFiles` を待つ）。他ウィンドウへの伝播は、ファイルを書いたウィンドウが `nd:settings-file-written` を流し、受け手が notecore 発の `nd:settings-file-changed` と同じ配線表（`services/settingsFileSync`）で該当の 1 件だけ読み直す。テーマ / ウィジェット / プラグイン / クエリも同じ経路。localStorage は Tauri 外（ブラウザ dev モード）だけの永続化で、Tauri では書かない（#1042 — かつての「ファイルが正、localStorage はミラー」の二重永続は、ミラーだけに残った個体の救済とミラー経由の対応表合流を含めて廃止した）。Rust 側に正本を移す案は不採用（[PR #172](https://github.com/notedeck-dev/notedeck/pull/172) で議論）。

## Note List: 表示述語とフェッチカーソル（[#831](https://github.com/notedeck-dev/notedeck/issues/831)）

大原則は **データは保持し、表示時に決める**。取り込み時フィルタ・物理削除は採らないため、ミュート/凍結の解除で表示が即時に復活する。

**2 つの基底（`useNoteList`）:**

| ref | 内容 | 用途 |
|-----|------|------|
| `rawNotes` | unfiltered な書込基底（writable） | 全ての read-modify-write（マージ・挿入・削除・truncate）と**同期位置の決定** |
| `notes` | `isHidden` 述語でフィルタした表示列（readonly） | 描画・**ユーザー可視状態の判定** |

読取の判別規則: `sinceId` / `untilId` / `hadNotes` / 空ガード / `refreshFetch` 引数 / キャッシュアンカーは `rawNotes`。skeleton 表示・エラー UI は `notes`。filtered を書込基底にすると、隠れているノートが書き戻しのたびに列から落ちて焼き込まれ、解除で復活しなくなる。

**規約**: `rawNotes` の setter を迂回してノートを挿入する経路を増やさない（[#828](https://github.com/notedeck-dev/notedeck/issues/828) の凍結 probe が「新規挿入 1 点フック」で全経路を捕捉する前提）。

**フェッチカーソル（`useNoteColumn`）:**

`fetchCursor = { id, createdAt } | null` に、取り込んだ**生ページ**（`filterNotes` 適用前）の最古ノートを保持する。ページングの位置決めはバッファ末尾ではなくこれを使う。

- API `loadMore` の `untilId` = `fetchCursor.id ?? rawNotes 末尾`
- キャッシュ `loadMore` のアンカー = `fetchCursor.createdAt ?? rawNotes 末尾の createdAt`
- 単調前進: 生ページの最古が現カーソルより古いときだけ更新（最新側ページで新しい方向へ戻さない）
- リセット: バッファを全置換する操作（reconnect / gap catch-up / タブ切替 / 非 streaming の refresh）で null にし、置換ページから貼り直す。旧世代カーソルが残ると新バッファとの間がサイレントにスキップされる

バッファ末尾を位置決めに使うと、ページが丸ごとフィルタで落ちたとき位置が前進せず、`loadMore` が同じページを取り続ける無限ループになる。

**表示述語 `useNoteVisibility().isHidden(note, opts?)`:**

判定材料は 2 種類に分かれる。**対象由来**（ユーザーミュート [#574](https://github.com/notedeck-dev/notedeck/issues/574) / インスタンスミュート [#613](https://github.com/notedeck-dev/notedeck/issues/613) / リノートミュート [#614](https://github.com/notedeck-dev/notedeck/issues/614) / 凍結 [#828](https://github.com/notedeck-dev/notedeck/issues/828)）は「誰か」に紐づき、**内容由来**（ワードミュート [#610](https://github.com/notedeck-dev/notedeck/issues/610) / 削除 tombstone [#602](https://github.com/notedeck-dev/notedeck/issues/602)）は「何が書かれているか・存在するか」に紐づく。

`VisibilityOpts` は面ごとの opt-out（既定は全適用 = 安全側）:

| opt | 無視する材料 | 適用面 |
|-----|------------|--------|
| `ignoreSuspension` | 凍結のみ | 自分が保存した面（お気に入り・自クリップ・詳細の祖先スレッド） |
| `ignoreSubject` | 対象由来を全て | 明示的に開いた面（プロフィール） |

面別マトリクス（本家の read-time フィルタ挙動に準拠）:

| 面 | opts |
|----|------|
| TL 全種 / リスト / アンテナ / チャンネル / ロール / メンション / explore / 検索 / 通知 | なし（全適用） |
| お気に入り / クリップカラム（自分 + お気に入りしたクリップ） | `ignoreSuspension` |
| クリップ詳細ウィンドウ | 自分のクリップなら `ignoreSuspension`、他人なら なし |
| ノート詳細・Lookup の本体ノート | 述語を通さない |
| ノート詳細・Lookup の祖先スレッド | `ignoreSuspension` |
| ノート詳細・Lookup の返信ツリー | なし |
| プロフィール（ノート / ファイル / ユーザーカラム） | `ignoreSubject` |

カラム系は `NoteColumnConfig.visibility` で指定し `useNoteList` へ透過する。独自 ref の面は `filterVisible(notes, opts)` を表示用 computed で使う（書込基底は unfiltered のまま）。「見えているもの」の下流供給（`reportVisibleItems`）には述語適用後を渡す。

**凍結ストア（`stores/suspensions.ts`）:**

サーバーで凍結（または削除）されたユーザーの per-account 集合。mutes は「自分の意思」、こちらは「サーバー側の事実」なので相乗りさせない。SQLite キャッシュは触らないので、凍結解除で自動的に表示が戻る。

検知は `users/show({ userIds })` の 3 値判定 — 応答から欠落 = 凍結（非モデレーターにはサーバーが `isSuspended:false` で絞る）/ `isSuspended === true` = 凍結（モデレーター経路）/ 返却され false = 解除。取得失敗は無更新（fail-open）。

probe の供給は**挿入 1 点フック**にまとめてある（`useNoteList` の `rawNotes` setter / `DeckNotificationColumn` の `notifications` watch / `useCrossAccountNotes` の `rawNotes` watch）。経路を列挙しないので、ストリーミングやページングの取りこぼしが構造的に起きない。解除の検知はストア自身の周期タイマー（15 分・aging 付き）が担当し、カラム構成にも probe 発火にも依存しない。

## Column Query（[#783](https://github.com/notedeck-dev/notedeck/issues/783)）

Krile 型「カラムごとのクエリフィルタ」。ユーザーは AiScript 1.2.1 の式（v1 サブセット）でカラムの視界を定義し、コンパイラが **QIR**（型付きクエリ IR、Rust が source of truth で specta 経由 bindings.ts に載る）へ落として全取り込み経路（キャッシュ復元 / REST / ページング / streaming / refresh）で同期評価する。表示制御 3 層モデル（#831）の層 2。

- **意味論の正本は AiScript 1.2.1**（不変条件 (a)）。全評価器（JS QIR eval / Rust QIR eval / 降格 Interpreter）は共有 golden vector（`src/services/columnQuery/golden/vectors.json`）で一致を CI 検証する
- 実装: `src/services/columnQuery/`（compiler / evaluator / referenceEvaluator / composeQir / degradedBatch / degradedRunner）。QIR 型・Rust 評価器・FTS プリフィルタ抽出は `crates/notecore/src/commands/column_query.rs`
- **実行形態は 2 つ**: コンパイル成功 = ⚡（QIR 同期評価 + インデックスを使ったキャッシュ検索）、サブセット外 = 🐢（専用 Web Worker で逐次適用）。🐢 でもできないのは高速検索だけで、表示の意味論は同じ。Worker バッチにはタイムアウトを張り、超えたら `terminate()` → 評価開始マーカーで犯人フィルタを特定してそれだけサスペンドする（AiScript の同期評価は abort できず step 予算もメモリを縛れないため、これが唯一の確実な停止手段）。サスペンド中を含むバッチは fail-closed。解除はユーザーの明示操作（「再開」）か、そのクエリのソース編集（コードが変わったので 1 回だけ再試行する。#783 追補 D / #1112）。有効・無効の切替やスコープ・適用の変更では解除しない（同じコードを黙って走らせ直さない）。サスペンドはウィンドウ内の共有状態で再起動で消える
- **ローカルキャッシュ検索**: ⚡ のカラムはページングでキャッシュを遡れる（`searchCachedNotesByQuery` → `qir_search_cache`）。FTS5 trigram で粗く絞ってから Rust QIR eval で最終判定する（プリフィルタは偽陰性を出さない = 不変条件 (b)）。母集合はカラムの所属バケット。notecli の実体/所属分離（notecli#30）が前提で、それ以前は所属が後勝ち上書きのため種別で絞ると取りこぼし、全体走査に倒していた
- **UX**: 定義・サイドロード・MisStore 導入はクエリ管理カラム（`queryManager`、ツール系）に一元化。適用はタイムラインカラムのフィルタメニューの「クエリ」トグル（`DeckColumn.noteQueryRefs` に id 参照、複数参照は And 合成）。カラムヘッダのバッジが実行形態（⚡ / 🐢 / ⚠）と per-note エラー件数を示す
- **編集履歴**: 他の配布物と同じ編集前スナップショットのリング（#1117）。保存とストア更新で積み、エディタの「履歴」から差分表示と復元（`queries.revert` capability、権限は `queries.read` / `queries.write`）
- **用語**: 「有効 / 無効」はアイテム（クエリ本体）の状態、「適用」はカラムへの紐付け。両方を「有効」と呼ぶと「無効なアイテムが適用中」という状態を説明できない
- **本体の有効 / 無効（#1043）**: プラグインと同じ位置のキルスイッチ。無効なクエリは参照している全カラムで評価上「無いもの」（fail-open。コンパイルしない・Worker に渡さない・キャッシュ検索の述語にも入れない）で、カラムの適用やスコープ参加には触れない。参照消失の fail-closed とは区別する（消失は意図しない欠落、無効化は意図的な停止。解釈不能なクエリも無効化すれば復帰する）。メタファイルには `active` を常に書き (#1202 段階 0 で他の配布物と揃えた。旧形式の `disabled` は読めて、起動時に書き戻す)、判定は `isQueryActive` の 1 箇所。ストア更新では維持、削除の undo は削除時の状態を復元。ソース欠損の読取専用個体は切り替えを拒否する（保存できず巻き戻るため。可視化と復旧は #1111）。表示: 適用がすべて無効なカラムはセーフモードと同じ「効いていない」バッジ（状態 `disabled`。優先順位は なし → セーフモード → 停止 → 解釈不能 → 🐢 → ⚡）、一部無効なら tooltip に無効名。フィルタメニューは未適用の無効なクエリを候補に出さず（使えない選択肢で場所と認知負荷を食わない）、適用済みの無効なクエリだけ「無効」チップ + 管理カラムへの導線付きで残す（外す導線と、効いていない理由を追えるように）。ライブラリピッカーの有効 / 無効ボタンは適用中（または無効中）の本体にだけ出す — スコープ未参加でも適用済みなら評価され続けるため止める場所が要るが、未適用の本体はプラグインのライブラリと同じく「追加」だけ。有効 / 無効の切替は逐次適用のサスペンドを解除しない（解除は明示の「再開」かソース編集だけ）
- 名前付きクエリはウィジェットと同じ sidecar 形式（`queries/<name>.is` + `.meta.json5`、`useColumnQueriesStore`）。参照消失・コンパイル不能は **fail-closed**（構成は捨てず、カラムを保留 + 診断表示）
- **スコープはプラグインと同型**（#1018）。クエリ管理カラムは全アカウント／per-account の両方で開け、開いた文脈がそのカラムの管理スコープになる。クエリ自体は純粋（アカウント状態を参照しない）だが、どのアカウントのカラムで選べるかを持たせてアカウントごとに使い分けられる。`global` / `installedFor`（`accountScopeKey`）のどちらも持たないものはライブラリのみで、ピッカーから各スコープへ追加する。適用側（フィルタメニューのクエリトグル）もスコープで絞るが、既に適用済みの参照は外れていても出す — 黙って消えると効いている理由が追えないため。アカウントに紐づかない面（全アカウント TL / クライアント検索）は全体スコープと、ログイン中のどれかのアカウントのスコープに入っているクエリを出す（`isQueryOfferedForAny`。全体スコープだけだとアカウントのカラムで作ったクエリが 1 つも出ずトグルの節ごと消える、2026-10-04）
- **セーフモード（#794 W1）中は停止する** — 起動時に自動実行されるユーザーコードなのでプラグインと同じ扱い。`useNoteColumn` の最上流 1 点でゲートし、コンパイル・Worker 起動・キャッシュ検索のすべてに入らない。停止中はフィルタなし表示（**fail-open**）で、理由はクエリ管理カラムに出す。仕様当初の fail-closed 案からの変更（#966）。クエリを設定しているカラムでは、停止中もヘッダのクエリバッジを彩度を落として出し続ける — バッジごと消えると「もともとクエリを設定していないカラム」と区別がつかず、隠していたものが予告なく表示に戻ったことに気づけないため（#971）
- MisStore 配布は**導入まで実装済み**（配布はソースのみ・ローカルで必ず再コンパイル = 不変条件 (e)、自動適用なし）。更新導線とソース差分の明示承認は Phase 3.5 の未実装分

## 配布物のファイル形式と codec（[#1202](https://github.com/notedeck-dev/notedeck/issues/1202)）

plugin / widget / query / skill / theme の 5 種は on-disk の形が違う（sidecar の `.is` + `.meta.json5` / skill の frontmatter つき `.md` / theme の `.ndtheme.json5`）。その差は **`src/services/distributableCodecs/<kind>Codec.ts` の codec が吸収し、メモリ上は `src/services/distributable.ts` の envelope（`DistributableMeta`: id / name / description / iconUrl / createdAt / updatedAt / store 3 点 / scope / content / extra）** に揃える（段階 0）。store は **`src/stores/distributableStore.ts` の factory（`createDistributableStore`）** の上に載せ替えた（段階 1。順は query → widget → plugin → skill → theme で、5 種とも済み）。

- **codec は固定 projection**: `toFile(fromFile(x))` が store の書くファイルとバイト一致する。TS が正本で、Rust（notecore の `sidecar/{plugins,widgets,queries}.rs` の `normalize_meta` と `themes.rs`、notemaid の `skills.rs`）は同じ golden `src/services/distributableCodecs/golden/vectors.json` を読んで一致を検査する（期待値は `pnpm gen:golden-distributables` で採り直す。tools.json と同じ運用）。store の書く形は codec そのもの（段階 1 で 5 種とも factory に載ったので、store 側の serialize と codec の一致を別に固定するテストは無い）
- **store factory は kind を知らない**: 共通のアクション（初回読込ゲート / add / remove+undo / 改名・本文更新 / 有効切替 / ストア更新の適用 / 基準記録 / 紐付け / アカウント削除時の掃除 / 変更通知の受け口 / 履歴 push）を 1 実装で持ち、kind 固有は宣言（`codec.enabled` / `purgeAccount` の `unlink` か `unlinkOrRemove` / 履歴の snapshot / `browserStorageKey`）と hook（`migrate` / `afterContentChange` / `afterEnabledChange` / `snapshotForUndo` / `restoreFromUndo` / `afterRemove`）で差し込む。**共通層に kind の分岐を書かない**。`afterContentChange` は本文が変わったときだけ（有効 / 無効の切替では呼ばない — query のサスペンド解除がその判断に乗っている）で、経路（自分の API か別の書き手の変更通知か）を受け取る（widget の再実行は別の書き手のときだけ — エディタの自動保存で走らせない #744）。`extra` の更新は `updateExtra`（widget の autoRun 等）。変更系は async に統一（決定 (e)）。sidecar の kind は `sidecarCollectionFor(codec, io)` で codec をコレクションに載せる。公開名は kind を問わず `items` / `get` / `add` / `update` / `setEnabled` / `remove` / `link` / `unlink` / `purgeAccount` / `applyStoreUpdate` / `recordStoreBaseline`（段階 3 の共通管理カラムがこの面を使う）
- **段階 0 で揃えた on-disk**: plugin と theme に createdAt / updatedAt を足した（theme は Misskey 互換の上位を保つため `$notedeck` の下）。query の `disabled`（反転・true のときだけ）は `active: boolean`（常に書く）になった。skill は変えていない
- **段階 1 の widget の回で揃えた on-disk（決定 (b) / (g) / (h) / (i)）**: `accountKey`（1 アカウントに固定）を `global: boolean`（常に書く）+ `installedFor`（空は書かない）に。固定も紐付けも無い旧個体は `global: true`、`accountId`（内部 UUID）だけの旧々個体は移行待ちとして `accountId` を残す（両書き手とも）。**実行アカウントは本体ではなくカラム側の配置が持つ**（`DeckColumn.widgetRefs: { id, accountKey? }[]`、サイドバーの並びも同形。旧 `widgetIds: string[]` はプロファイル読込で移す。同じ本体を alice 用と bob 用に 2 つ置くのは配置の重複）。**Mk:save は `app-<installId>/<accountKey>` で名前空間を分け**、Mk:load は名前空間つきの鍵に無ければ旧 `app-<installId>` を読む（`services/widgetPlacement.ts`）。同じ storeId の複製（アカウント別のコピー）は初回読込で最古の本体に統合し（紐付けを束ね、分岐した本文は本体の履歴へ、Mk:save は本体の名前空間へ、配置は本体 id + 実行アカウントへ書き換え）、固定だった本体の配置にも実行アカウントを足す。副作用は代表窓だけが行い（`isRepresentativeNow`、#1131）、カラムの配置の書き換えは widgets store が積んだものを deck store が取り出して全プロファイルに当てる
- **段階 1 の plugin の回で揃えたこと**: on-disk は変えていない（段階 0 で揃え済み）。**起動 / 停止は plugins store の hook に一本化**し、呼び出し側（管理カラム / 編集ウィンドウ / capability / misstore / 変更通知）は store の API（`setEnabled` / `update` / `setConfigData` / `applyStoreUpdate` / `remove` と undo / `add`）だけを呼ぶ。有効の切替・本文の変更・設定値の変更（`Plugin:config` は起動時に組まれるので新しい値で起動し直す）・ストア更新・undo の復活は「写しの状態に実行基盤を合わせる」1 関数で、削除と別の書き手による削除は停止。store は実行基盤（`aiscript/plugin-api`）を遅延 import する（plugin-api は handler のスコープ評価で store を見るので、静的に輪を作らない。テストで plugin-api をモックするときは `importOriginal` を使わず丸ごと差し替える — 本物を読むと store が本物の輪の中で読まれ、hook の遅延 import がモックを見ない）。`installedFor` の旧 UUID → 安定キーの移行は accounts ロード後に kind 側で走り、「どこにも参加していない個体を全体スコープへ救済する」旧規則は外した（「外す」で空にした本体が次の起動で全体スコープへ戻るバグだった。参加先が全滅した個体もライブラリのみに残る）
- **段階 1 の skill の回で揃えたこと**: on-disk は変えていない。単一ファイルの kind は `singleFileCollectionFor(codec, io)`（`distributableCodecs/singleFile.ts`、sidecar 版と対。ID 凍結の実効値 / 注入は codec では決まらないので io が持つ）で codec をコレクションに載せる。**予約 skill（AGENTS / HEARTBEAT）はファイル名で決まる runtime-only の印**（codec が `extra.reserved` に立てる）で、改名・mode 変更・persona 化・有効無効・削除の拒否は kind 側の store が行い（共通層は予約を知らない。読取専用のゲートは skill には無関係 — 単一ファイルにソース欠損は無い）、規約外名の copy-adopt からも kind 側のコレクションの包みで外す。ブラウザ dev モードでは保存しない（`browserStorageKey` 無し、メモリだけ）。factory の `update` は編集で変わる kind 固有の値を `extra` で受け（履歴の範囲が動けば積む。skill の mode 等）、状態の印だけの `updateExtra`（履歴なし）と使い分ける。`reload(filename)` は変更通知を待たずに 1 ファイルを読み直す口（notemaid が置いた予約 skill を開く経路）。旧 built-in（aizu / 同梱をやめた 9 本）と端末ローカルの有効一覧の移行は `migrate` hook（純ロジックは `services/storeMovedSkills.ts`）
- **段階 1 の theme の回で揃えたこと**: on-disk は変えていない。インストール済みテーマのプールだけを factory に載せ、選択・適用・per-account の適用キャッシュ・カスタム CSS は `useThemeStore` の持ち物のまま（削除で選択を外す / undo で戻す / 選択中のテーマの中身が変わったら当て直す、は hook）。読込は `init` が起動時に始める（eager。選択中のテーマを当てるのに一覧が要る）。コンパイラ / 適用器 / プレビューに渡す Misskey 互換の形は `misskeyThemeOf(item)`。紐付けが空になった本体は消す（`unlinkOrRemove`。テーマには「全体」の印が無く、紐付け 0 はどの管理カラムにも出ない）ので、旧 UUID → 安定キーの移行では先に足してから外す。ストアからのインストールは他の kind と同じ `add` / `applyStoreUpdate` + `link` になり（ローカル ID = storeId、占有時は連番）、確認の diff はファイルに書く形（codec の projection）同士。factory に「一覧の読込に失敗した起動ではファイルに一切書かない」ガード（`onLoadFailed` hook で通知）を足した — theme だけが持っていた規則で、同じ ID の個体を入れると既存のファイルの横に別名で書かれる事故を全 kind で防ぐ
- **段階 2 (ストア連携の一本化)**: MisStore からのインストール / 更新 / インストール済み判定の手続きは `src/stores/misstore.ts` の 1 本（`installFrom` / `updateFrom` / `isInstalledIn`）で、kind ごとに違うのは宣言（`StoreKind`: レジストリの feed、相手の store、ソースの読み方 `parse`、新規個体の形 `add`、確認を出す条件 `changed` と注意 `caution`、diff の中身と言語、確認のタイトル）だけ。手続き: 取得 + sha 照合（不一致は index 再取得の 1 回リトライ）→ ソースを読む → storeId で既存を探す → 既存なら sha が違うときだけ（= 中身が変わっているときだけ）kind の条件で確認して `applyStoreUpdate`、確認を断られても参加先（`link`）は足す → 無ければ `add`（ローカル ID = storeId、占有時は連番 suffix）。更新は参加先に触れない。plugin の確認条件は本文の差ではなく権限の拡大（再同意の抜け穴を作らない）、theme は見た目（base / props）の差。feed（index の取得 / TTL / baseline 記録 / 更新検知）は相手の store を受けるだけで kind を知らない。kind 名つきの公開名（`installPlugin` / `updateTheme` 等）は段階 3 で畳み、公開面は kind を引数に取る `feed(kind)`（一覧 / 読込中 / エラー / 取得 / 再取得）/ `install(kind, entry, targets)` / `update(kind, entry)` / `installedIn(kind, entry, target?)` / `hasUpdate(kind, entry)` / `installing(kind)` だけ（widget のソース取得 `fetchWidgetSource` は配置側のテンプレが使うので別）
- **段階 3 (管理カラムの共通殻)**: 5 種の管理カラム（`DeckPluginManagerColumn` / `DeckWidgetColumn` / `DeckQueryManagerColumn` / `DeckSkillColumn` / `DeckThemeManagerColumn`）は `src/components/deck/DeckDistributableColumn.vue` の 1 つの殻に載る。殻が持つのは kind を知らない面だけ: ヘッダー（タイトル / セーフモードの注意 / 「+」/ ストアの再取得）、「インストール済み / ストア」タブ、検索、有効 / 無効の絞り込み（`@enabled` / `@disabled` 接頭辞、宣言した kind だけ出す）、ライブラリからの追加ピッカー、sideload と store の区分（`item.store` の有無）、ストアの取得状態（読込 / エラーバナー、インストール・更新の失敗もここに流す `run(action, fallback)`）、空表示。kind 側（wrapper）は宣言（`items` / `libraryCandidates` / `enabledFilter` / `texts` / `store` の feed）と slot（`card` の中身、`store-card`、必要なら `installed` の一覧全体や `installed-empty`）だけを渡す。theme は一覧を区分（既定 / sideload / store / サーバー）で、widget は配置順の並べ替えで `installed` slot を差し替える。ストアとのやりとりは `useMisStoreStore()` の kind 引数つきの公開面（段階 2 の項）だけで、kind 名つきの名前は無い。殻に揃えて直した差: theme の「外す」も undo つきトースト（他と同じ）、query はアカウントの見つからないカラムで「+」を出さない（作った直後に消える個体を作らせない）、絞り込みボタンはもう一度押すと解除。ピッカーを開くボタンの文言は全 kind「ライブラリから追加」。殻は `generic` で Item / entry の型を受けるので、`<script setup … generic=…>` は 1 行で書く（Vapor 互換 lint が `<script setup` を行単位で探す）
- **移行は読込時の書き戻し**: 旧形式のファイルは両方の書き手が読め（コレクションの `isOutdated` → `loadAll().outdated`）、TS は代表窓が起動時に一度だけ書き戻す（`isRepresentativeNow`、#1131）。Rust は書くときに埋める（`normalize_meta` / `install_theme`）
- **「有効」は kind が宣言で opt-in する**（`codec.enabled`）: plugin / query は `active`、skill は `active` + mode=always の実効値。widget（autoRun は有効フラグではない）と theme（選択は settings 側）は持たない
- **スコープは「共有 / なし」の 2 戦略**（決定 (b)）: plugin / widget / query は global + installedFor、theme は installedFor だけ、skill は無し。widget の紐付けは「どのアカウントのカラムで選べるか」で、実行アカウントは配置が持つ

## Theme 管理

**ファイル:**
- `src/stores/theme.ts` — `manualMode` (`'light' | 'dark' | null`) + `isCurrentDark` の合流点
- `src/capabilities/builtins/theme.ts` — theme.* capability 群

**per-account 紐付け:** `themes.create` は作成時に当該 account の `installedFor` に自動追加。プロファイル切替で適用範囲が切り替わる (詳細は [DESIGN.md](DESIGN.md) の「per-account 設定」)。

**自動モード切替:** `themes.apply(id, mode?)` は明示 mode 指定がない場合でも、テーマの base (`light` / `dark`) に応じて `manualMode` を自動切替し、画面が即時更新される。AI が theme 作成 → apply のフローで「画面が変わる」体験を成立させるための仕組み。

## Guest Mode & Logout Fallback

NoteDeck はトークンを持たないユーザーでも公開タイムラインを閲覧できます。

### ゲストモードとログアウト済みアカウント

| | ゲスト | ログアウト済み |
|---|---|---|
| **userId** | `__guest__`（固定値） | 正規のユーザー ID |
| **hasToken** | `false` | `false` |
| **カラム・設定** | 一時的 | 保持される |
| **UI** | 操作ボタンをグレーアウト | 赤い「ログアウト中」バナー + 再ログイン促進 |

### Rust バックエンド（`crates/notecore/src/`）

- **`get_credentials_or_anon()`** — トークンがあればそのまま、なければ `(host, "")` を返す。notecli が空トークンを検知して公開 API を呼び出す
- **`create_guest_account()`** — `userId = "__guest__"`, `token = ""` のアカウントを DB に作成
- **`logout_account()`** — トークンのみ削除し、アカウント記録と設定は保持

公開 API 対応のコマンドは `get_credentials_or_anon()` を使用し、認証必須のコマンド（投稿・リアクションなど）は従来通り `get_credentials()` を使用します。

削除/ログアウトは「資格情報の無効化 → backend 切断」の順で行い（#700。先に切断すると購読の自己回復が有効な資格情報で WS を復活させる競合窓がある）、このとき `streamHealth` のエントリも破棄します。

### フロントエンド

| ファイル | 役割 |
|---------|------|
| `src/stores/accounts.ts` | `GUEST_USER_ID`, `isGuestAccount()` |
| `src/composables/useAccountMode.ts` | `isGuest`, `canInteract` computed |
| `src/composables/useLoginPrompt.ts` | `showLoginPrompt()` — ログイン促進トースト |

ゲスト / ログアウト時の操作ボタン（リアクション・リプライ・リノート）は disabled になり、クリックすると `showLoginPrompt()` でログイン促進トーストを表示します。

### 新しい API コマンドを追加するとき

- **公開 API**（認証不要）→ `get_credentials_or_anon()` を使う
- **認証必須 API** → `get_credentials()` を使う
