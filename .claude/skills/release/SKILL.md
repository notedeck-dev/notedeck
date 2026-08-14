---
name: release
description: NoteDeck のリリース作業（バージョンバンプ → PR → タグ push → Release 確認）を手順どおり実行
user-invocable: true
disable-model-invocation: true
argument-hint: "[X.Y.Z]"
allowed-tools: Bash(git *), Bash(gh *), Bash(bash scripts/*), Bash(pnpm *), Read
---

# リリース手順

正本は [CLAUDE.md](../../../CLAUDE.md) の「リリース手順」。ここはその実行チェックリスト。
引数でバージョン `X.Y.Z` を受け取る。省略時は `package.json` の現バージョンから patch バンプを提案し、ユーザーに確認してから進める。

## 前提チェック

1. `git branch --show-current` が `develop` であること
2. working tree が clean であること（clean でなければ中断して報告）
3. `git pull` で最新化

## 1. バージョンバンプ（develop 上）

1. `bash scripts/bump-version.sh X.Y.Z`
   - `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` の同期、`Cargo.lock` 更新、`openapi.json` 再生成までまとめて行われる
2. 差分を確認してコミット
   - `chore: bump version to X.Y.Z`
   - `chore: regenerate openapi.json for X.Y.Z`（1 コミットにまとめても可。過去ログは分けるパターンが多い）
3. develop に push

## 2. PR 作成・マージ

1. `pnpm changelog` で変更一覧を生成
2. develop → main の PR を作成（タイトル: `Release vX.Y.Z`、本文に changelog）
3. `gh pr checks --watch` で CI（lint / typecheck / test / openapi_snapshot）が全部通るのを確認
4. マージ方法は既存の Release PR に倣う。**マージ前にユーザーへ確認する**

## 3. タグ作成・push（CI トリガー）

タグ push は `release.yml`（マルチ OS ビルド → Release draft → AUR/winget 更新）を起動する不可逆操作。**実行前にユーザーへ確認する**。

```bash
git checkout main && git pull
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

GPG 署名（`-s`）が失敗したら、まずこのシェルで直接リトライして原因を確認する。

## 4. GitHub Release 確認

- `gh run watch` で release.yml の進行を確認
- draft Release が作成されたら内容（アーティファクト: AppImage / DMG / NSIS / latest.json / SHA256SUMS.txt 等）を報告
- publish の判断はユーザーに委ねる

## 後始末

- `git checkout develop` に戻る
- release PR に `Closes #NNN` を書いた issue が自動クローズされたか確認
