# Code signing policy

Windows 版のコード署名についての方針です。この内容は [English](/en/docs/code-signing-policy) でも読めます。

::: warning 現在の状態
SignPath Foundation に申請中です。承認されるまで、Windows 版は未署名のまま配布しています（[初回起動時の警告](/docs/install#初回起動時の警告)）。承認後のリリースから下記のとおり署名します。
:::

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## 署名するもの

- 署名するのは、この[公開リポジトリ](https://github.com/notedeck-dev/notedeck)のソースから作った Windows 向けの成果物だけです（インストーラ、アプリ本体、同梱する `notemaid`、単体配布の `notecli`）
- ビルドは GitHub Actions のリリース用ワークフロー（[`release.yml`](https://github.com/notedeck-dev/notedeck/blob/main/.github/workflows/release.yml)）が、バージョンタグから行います。タグはリリース手順に従って `main` に取り込んだコミットに付けます。開発者の手元で作ったバイナリには署名しません
- 第三者が作ったバイナリに、このプロジェクトの名前で署名することはありません
- 署名の要求は、リリースのたびに下記の承認者が内容を確かめて承認します

## チームの役割

| 役割 | 担当 |
|---|---|
| Committers and reviewers | [hitalin](https://github.com/hitalin) |
| Approvers | [hitalin](https://github.com/hitalin) |

リポジトリに書き込めるのは上記の担当だけです。それ以外の人からの変更はプルリクエストで受け取り、担当がレビューしてから取り込みます。担当者の GitHub アカウントは多要素認証を必須にしています。

## プライバシー

NoteDeck は利用統計・クラッシュレポート・広告のための通信を行いません。開発者が利用者のデータを受け取る経路もありません。外部との通信は、主に次のものです。

- 利用者がログインした Misskey サーバーとの通信
- ノートやプロフィールに含まれる画像などのメディアの取得（そのメディアを置いているサーバーへ）
- 利用者が設定した AI プロバイダーや外部サービスとの通信（その機能を使うときだけ）
- 更新の確認（GitHub Releases）
- ノートに含まれる URL のプレビュー取得（設定で無効にできます）
- ストアの一覧と配布物の取得（`store.notedeck.io`）、ペットの取得（`petdex.dev`）、アイコンや Web フォントの取得
- 利用者が入れたプラグインやウィジェットが行う通信

通信先の全体は[プライバシーポリシー](/docs/privacy)にあります。

## 問題の報告

署名された配布物に問題を見つけたら、[GitHub の issue](https://github.com/notedeck-dev/notedeck/issues) で知らせてください。脆弱性は公開の issue ではなく[非公開の報告](https://github.com/notedeck-dev/notedeck/security/advisories/new)でお願いします。
