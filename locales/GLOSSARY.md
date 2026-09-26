# 用語集 (#135)

UI 文言の正準の語。辞書 (`ja-JP.yml` とその訳) はここに合わせる。語を変えるときはこの表を先に直す。

- **本家**の列は misskey-dev/misskey の `locales/` での語。「揃えない」ものは理由を必ず書く (同じ提案の再検討を防ぐため)
- en の語はサイトの英語版 (#1145) で使っている語を正本にする
- 固有名詞 (NoteDeck / Misskey / フォーク名 / AiScript / MisStore / HEARTBEAT) は訳さない

| ja | en | 本家 ja / en | 揃えるか | 理由 |
|---|---|---|---|---|
| サーバー | server | サーバー / Instance | en は揃えない | サイトの英語版が server で統一している。Fediverse の一般利用者に instance より通じる |
| プロファイル | profile | プロファイル (`_deck.profile`) / Profile | 揃える | デッキのカラム構成一式 |
| プロフィール | user profile | プロフィール / Profile | en は揃えない | 本家 en はプロファイルとプロフィールがどちらも Profile で区別が消える。このアプリは両方を同じ画面で扱うので、ユーザー情報の側を user profile にする |
| カラム | column | カラム / Column | 揃える | |
| デッキ | deck | デッキ / Deck | 揃える | |
| ノート | note | ノート / Note | 揃える | |
| リノート | renote | リノート / Renote | 揃える | |
| リアクション | reaction | リアクション / Reaction | 揃える | |
| タイムライン | timeline | タイムライン / Timeline | 揃える | |
| ダイレクト | direct | 指名 (`_deck._columns.direct`) / Direct notes | ja は揃えない | 公開範囲の選択肢と同じ語で見せる。カラム名だけ本家に合わせると同じ機能が 2 つの名前を持つ |
| チャット | chat | ダイレクトメッセージ (カラム名) / Chat with user | ja は揃えない | 本家もルートの `chat` は「チャット」で、本家の中で割れている |
| メモ | memo | メモ (ユーザーメモ) / Memo | 注意 | このアプリのメモは AI とユーザーのローカルメモ。本家のユーザーメモ (相手ユーザーに付ける注記) と同じ語なので、ユーザーメモの側を指すときは「ユーザーメモ」と書く |
| フォローリクエスト | follow request | フォロー申請 / Follow request | ja は揃えない | 既存 UI と site がフォローリクエストで統一している |
| ウィンドウ | window | ウィンドウ / Window | 揃える | |
| ナビバー | navbar | ナビゲーションバー / Navigation bar | 揃えない | site の英語版が navbar |
| スキル | skill | — | — | 本家に無い |
| 開発者モード | developer mode | 開発者 / Developer | — | 本家は設定の節の名前で、モードの切り替えは無い |
| 全アカウント | all accounts | — | — | 本家に無い (クロスアカウント) |
