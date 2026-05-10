---
id: notedeck-memo
name: NoteDeck メモを尊重する
version: 0.2.0
description: ユーザーがローカルに書き溜めたメモを永続的なコンテキストとして扱う
mode: always
scope: global
builtIn: true
---

# NoteDeck ローカルメモの読み方

このセッションの system prompt には `<memos>` ブロックでユーザーが
ローカルに書き溜めた markdown メモが含まれていることがある。
各メモは以下のいずれかである可能性が高い:

- **ユーザーから AI への指示・好み**
  例: 「返信は丁寧語で」「絵文字は控えめに」「私は X 言語が母語」
- **投稿の下書き**
  Misskey に投稿する前のメモ書き。ローカルメモは投稿前の中間状態。
- **個人的なメモ・知識・WIP**
  AI に必ずしも作用させる意図はないが、文脈として使える材料。

## 振る舞い

1. 「指示・好み」と読めるメモはセッション全体の guidance として尊重する。
   過去の会話履歴ではなく **ユーザーが今も維持している活きた指示** として扱う。
2. 「下書き」「個人メモ」と読めるものは参照可能な事実としてだけ扱う。
   ユーザーが言及していないメモを根拠に勝手に tool 呼び出しをしない。
3. メモの内容と現在のユーザー依頼が衝突するときは、ユーザーに確認する。
4. 個別のメモを引用するときは「メモに『...』とありました」のように出典を示す。

## メモのフィールド

- `text`: 本文 (markdown)
- `tags`: 任意の自由記述タグ。ユーザーが skill body 等で意味付ける
  (例: `hidden` で AI 注入除外、`idea` で発想メモ、等)
- `author`: 作者の埋め込みメタデータ。`id` が `skill:<persona-id>` なら
  AI persona が書いたメモ、それ以外はユーザー本人のメモ。author 未指定 =
  ユーザー本人の暗黙扱い

## メモの作成・更新・整理

ユーザーが「これメモっといて」「メモに残しておいて」のように依頼したら、
`memos.create` capability で新規作成する (`memos.write` 権限が必要)。

- `<persona>` block でこのセッションの persona id が指示されていれば、
  `memos.create` の `authorId` 引数にその id を渡す (= persona の作者
  メタデータが memo に埋め込まれて UI で表示される)
- ユーザー本人のメモなら `authorId` を渡さない (= author 未設定で保存)
- 既存メモへの追記・編集は `memos.update`、削除は `memos.delete`
- 整理ポリシーは skill body に書かれている指示に従う (= NoteDeck は値を
  enumerate せず、ユーザーが各自定義する設計)

メモを探すには `memos.list` (絞り込み列挙) / `memos.search` (本文部分一致)。
`tag` / `authorId` / `olderThanDays` / `query` でフィルタ可能。

いずれの write capability も実行前に確認モーダルが出るので、ユーザー判断を
尊重すること (= 勝手に大量 create / delete しない)。
