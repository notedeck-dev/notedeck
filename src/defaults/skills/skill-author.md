---
id: skill-author
name: スキル作者
version: 1.0.0
description: 会話で見つけたノウハウ・手順・判断基準をスキルとして書き起こし、skills.create で保存するまでを担当するスキル。
mode: trigger
triggers:
  - スキル
  - すきる
  - skill
  - スキル化
  - ノウハウ
  - 手順化
scope: global
builtIn: true
isPersona: false
---

# スキル作者 — 会話のノウハウ → スキル

ユーザーが「今のやり方をスキルにして」「この手順を覚えて次も使って」など、
**会話の中で確立したノウハウ・手順・判断基準の恒久化** を依頼したら、
markdown 本文を書いて `skills.create` capability を呼ぶ。保存確認ダイアログは
dispatcher が自動で出す (こちらで組み立てなくてよい)。

**既存スキルの改善・追記は `skills.create` の領分ではない**。
`skills.list` → `skills.read` で対象を特定し、`skills.append` (末尾追記) か
`skills.replaceSection` (セクション置換) を使うこと。同名の新スキルを作って
実質上書きを図らない。

## mode の選び方

| mode | 使いどころ |
|---|---|
| `manual` (default) | 迷ったらこれ。ユーザーがスキルカラムから手動で有効化 |
| `trigger` | 特定の話題でだけ効かせたいノウハウ。`triggers` 必須 |
| `always` | 毎ターン system prompt に注入される。**ユーザーが明示したときのみ** |
| `heartbeat` | HEARTBEAT tick ごとに自動実行される。**ユーザーが明示したときのみ** |

`always` / `heartbeat` は保存した瞬間から AI の指示ストリームに自動合流する
(= 影響が大きい) ので、先回りで選ばない。まず `manual` で作って様子を見て、
ユーザーが常用すると言ったら mode を上げる流れが安全。

`heartbeat` を選ぶ場合は `cheapCheckCapabilities` に変化検知用の cheap
capability id を渡すと、変化がない tick の AI 呼び出しを skip できる
(= コスト削減)。

## 良いトリガー設計 (mode=trigger)

- マッチは user 入力への **部分一致・大文字小文字無視**。正規表現は使えない
- 日本語・英語・かな表記ゆれを併記する (例: `翻訳` / `translate` / `ほんやく`)
- 「して」「お願い」のような汎用語は誤爆するので入れない
- 一度マッチするとそのセッション中はロードされ続けるので、本文は
  **ロードされたターンだけで完結する自己完結型** に書く (前のターンの文脈に
  依存する書き方をしない)

## 本文の書き方

- `## セクション` 構造にする。後から `skills.replaceSection` で節単位に
  育てられる (= 自己改善の土台になる)
- 「やること」と「やらないこと」を対で書くと AI が従いやすい
- **会話で実際に確認できた事実・手順だけ** を書く。一般論に薄めない。
  ユーザーの言い回しや具体例をそのまま残すほうが再現性が高い

## スキル分割の作法

- 1 スキル 1 関心。長くなったら分割する
- 「実践知」と「リファレンス」は分ける。組み込みの `widget-author` (作法) ↔
  `aiscript-author` (言語リファレンス) が実例。リファレンス側は trigger を
  広めに、実践知側は狭めにすると無駄なロードが減る
- 分割したスキル同士は本文中で名前で参照し合う

## `skills.create` 呼び出し方

```
skills.create({
  name: "スキル名",
  description: "1 行説明",       // 省略可
  mode: "manual",                // 省略可、default: manual
  triggers: ["翻訳", "translate"], // mode=trigger のとき必須
  body: "# タイトル\n\n## やること\n..."
})
```

- **body に frontmatter (`---` ブロック) を含めない**。mode / triggers /
  description はパラメータで渡す (含めるとエラーで拒否される)
- id は内部生成される (指定できない)。返り値の id で以降 `skills.read` /
  `skills.append` / `skills.toggle` を呼ぶ
- 作成直後に今のセッションで使いたい場合は `skills.toggle({ id, active: true })`
  を呼ぶ。mode=trigger なら次のターンからマッチで自動ロードされる

## 作成後にユーザーに伝えること

create が成功したら短く伝える:

> 「スキル『○○』を作成しました。スキルカラムから有効化してください。」

mode=trigger なら「『△△』の話題になると自動で効きます」、有効化まで済ませた
なら「もう有効になっています」と一言添える。

## やらないこと

- ユーザーの明示なしに `always` / `heartbeat` を選ばない
- 会話に出ていないノウハウを勝手に一般化して書かない
- 既存スキルの改善依頼を新規作成で処理しない (= append / replaceSection へ)
- 頼まれていないのに会話のたびにスキル化を提案しない
