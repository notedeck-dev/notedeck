// 生成物 — 編集しない。locales/ から `pnpm gen:i18n` で作る (#135)

import type { ParameterizedString } from './types'

export interface Locale {
  readonly "_time": {
    /** たった今 */
    readonly "justNow": string
  }
  readonly "_settings": {
    /** 表示言語 */
    readonly "language": string
    /** システムに合わせる */
    readonly "languageAuto": string
    /** {name} (翻訳中) */
    readonly "languageUnpublished": ParameterizedString<'name'>
    /** 切り替えるとすべてのウィンドウを再読み込みします */
    readonly "languageReloadNote": string
  }
  readonly "_columns": {
    /** タイムライン */
    readonly "timeline": string
    /** 通知 */
    readonly "notifications": string
    /** ドライブ */
    readonly "drive": string
    /** フォローリクエスト */
    readonly "followRequests": string
    /** リスト */
    readonly "list": string
    /** アンテナ */
    readonly "antenna": string
    /** お気に入り */
    readonly "favorites": string
    /** クリップ */
    readonly "clip": string
    /** メンション */
    readonly "mentions": string
    /** ダイレクト */
    readonly "specified": string
    /** チャット */
    readonly "chat": string
    /** 実績 */
    readonly "achievements": string
    /** サーバー情報 */
    readonly "serverInfo": string
    /** Misskeyについて */
    readonly "aboutMisskey": string
    /** カスタム絵文字 */
    readonly "emoji": string
    /** 広告 */
    readonly "ads": string
    /** みつける */
    readonly "explore": string
    /** お知らせ */
    readonly "announcements": string
    /** サーバー検索 */
    readonly "search": string
    /** クライアント検索 */
    readonly "clientSearch": string
    /** 照会 */
    readonly "lookup": string
    /** チャンネル */
    readonly "channel": string
    /** ロール */
    readonly "role": string
    /** ギャラリー */
    readonly "gallery": string
    /** Misskey Play */
    readonly "play": string
    /** ページ */
    readonly "page": string
    /** ユーザー */
    readonly "user": string
    /** チャート */
    readonly "charts": string
    /** 連合 */
    readonly "federation": string
    /** テーマ */
    readonly "themeManager": string
    /** プラグイン */
    readonly "pluginManager": string
    /** ウィジェット */
    readonly "widget": string
    /** クエリ */
    readonly "queryManager": string
    /** メモ */
    readonly "memos": string
    /** AI */
    readonly "ai": string
    /** スキル */
    readonly "skill": string
    /** スクラッチパッド */
    readonly "aiscript": string
    /** APIコンソール */
    readonly "apiConsole": string
    /** APIドキュメント */
    readonly "apiDocs": string
    /** ストリーム */
    readonly "streamInspector": string
    /** タスク */
    readonly "taskRunner": string
  }
  readonly "_columnGroups": {
    /** アカウント */
    readonly "account": string
    /** サーバー */
    readonly "server": string
    /** ツール */
    readonly "tool": string
  }
  readonly "_columnPicker": {
    /** マイクリップ */
    readonly "myClips": string
    /** お気に入り */
    readonly "favorites": string
    /** マイリスト */
    readonly "myLists": string
  }
  readonly "_windows": {
    /** ノート */
    readonly "noteDetail": string
    /** ノートインスペクタ */
    readonly "noteInspector": string
    /** 通知インスペクタ */
    readonly "notificationInspector": string
    /** プロフィール */
    readonly "userProfile": string
    /** サーバー */
    readonly "federationInstance": string
    /** フォロー / フォロワー */
    readonly "followList": string
    /** エージェント */
    readonly "aiSettings": string
    /** 権限 */
    readonly "permissions": string
    /** プラグイン */
    readonly "plugins": string
    /** キーバインド */
    readonly "keybinds": string
    /** カスタムCSS */
    readonly "cssEditor": string
    /** テーマ */
    readonly "themeEditor": string
    /** プロファイルエディタ */
    readonly "profileEditor": string
    /** アカウント追加 */
    readonly "login": string
    /** NoteDeck について */
    readonly "about": string
    /** ナビバー */
    readonly "navEditor": string
    /** パフォーマンス */
    readonly "performanceEditor": string
    /** アピアランス */
    readonly "appearanceEditor": string
    /** バックアップ */
    readonly "backup": string
    /** キャッシュ */
    readonly "cacheEditor": string
    /** タスク設定 */
    readonly "tasksEditor": string
    /** スニペット */
    readonly "snippetsEditor": string
    /** メモ */
    readonly "memoEditor": string
    /** カラムクエリ */
    readonly "columnQueryEditor": string
    /** ページ */
    readonly "pageDetail": string
    /** Play */
    readonly "playDetail": string
    /** ギャラリー */
    readonly "galleryDetail": string
    /** リスト */
    readonly "listDetail": string
    /** クリップ */
    readonly "clipDetail": string
    /** ファイル */
    readonly "driveFileDetail": string
    /** ページを編集 */
    readonly "pageEdit": string
    /** Play を編集 */
    readonly "playEdit": string
    /** ウィジェット編集 */
    readonly "widgetEdit": string
    /** スキル編集 */
    readonly "skillEdit": string
    /** 編集履歴 */
    readonly "editHistory": string
    /** 接続 */
    readonly "connections": string
    /** 接続を編集 */
    readonly "connectionEdit": string
    /** チュートリアル */
    readonly "tutorial": string
    /** チュートリアル */
    readonly "tutorialEditor": string
  }
  readonly "_commands": {
    /** コマンドパレット */
    readonly "commandPalette": string
    /** サーバー検索 */
    readonly "search": string
    /** クライアント検索 */
    readonly "clientSearch": string
    /** 通知 */
    readonly "notifications": string
    /** ノート作成 */
    readonly "compose": string
    /** カラム追加 */
    readonly "addColumn": string
    /** カラムを左に移動 */
    readonly "moveColumnLeft": string
    /** カラムを右に移動 */
    readonly "moveColumnRight": string
    /** サイドバー切替 */
    readonly "toggleSidebar": string
    /** ウィンドウを隠す */
    readonly "bossKey": string
    /** アカウントメニュー */
    readonly "accountMenu": string
    /** プロファイル切替 */
    readonly "profileMenu": string
    /** 設定メニュー */
    readonly "settingsMenu": string
    /** チュートリアル */
    readonly "tutorial": string
    /** ダーク/ライトモード切替 */
    readonly "toggleDarkMode": string
    /** オフラインモード切替 */
    readonly "toggleOfflineMode": string
    /** リアルタイムモード切替 */
    readonly "toggleRealtimeMode": string
    /** 全キャッシュ削除 */
    readonly "clearAllCache": string
    /** 次のノート */
    readonly "noteNext": string
    /** 前のノート */
    readonly "notePrev": string
    /** 返信 */
    readonly "noteReply": string
    /** リアクション */
    readonly "noteReact": string
    /** リノート / 引用 */
    readonly "noteRenote": string
    /** ブックマーク */
    readonly "noteBookmark": string
    /** ノートを開く */
    readonly "noteOpen": string
    /** CW切替 */
    readonly "noteCw": string
    /** ノートを削除 */
    readonly "noteDelete": string
    /** ノートのリンクをコピー */
    readonly "noteCopyLink": string
    /** ノートの内容をコピー */
    readonly "noteCopyContent": string
    /** 次のカラム */
    readonly "columnNext": string
    /** 前のカラム */
    readonly "columnPrev": string
    /** カラム {n} に移動 */
    readonly "focusColumn": ParameterizedString<'n'>
    /** クイックリアクション {n} */
    readonly "quickReact": ParameterizedString<'n'>
    /** 新しいプロファイルを作成 */
    readonly "profileNew": string
    /** カラムを削除 */
    readonly "closeColumn": string
    /** 名前を変更 */
    readonly "renameEntity": string
    /** サーバーから削除 */
    readonly "deleteEntity": string
    /** カラムのミュート切替 */
    readonly "toggleColumnMute": string
    /** キーバインド設定 */
    readonly "keybinds": string
    /** カスタムCSS */
    readonly "cssEditor": string
    /** 開発者モードを切り替え */
    readonly "developerMode": string
    /** タスク設定 */
    readonly "tasksEditor": string
    /** スニペット */
    readonly "snippetsEditor": string
    /** デフォルトタスクを実行 */
    readonly "tasksRunDefault": string
    /** プラグインを管理 (このアカウント) */
    readonly "plugins": string
    /** プラグインを管理 (全アカウント) */
    readonly "pluginsGlobal": string
    /** テーマを管理 (このアカウント) */
    readonly "themeManager": string
    /** テーマを管理 (全アカウント) */
    readonly "themeManagerGlobal": string
    /** アピアランス */
    readonly "settingsEditor": string
    /** アカウント追加 */
    readonly "login": string
    /** チャット */
    readonly "chat": string
    /** AIアシスタント */
    readonly "ai": string
    /** フローティングウィンドウをすべて閉じる */
    readonly "closeAllFloatingWindows": string
    /** カラムを別ウィンドウにポップアウト */
    readonly "popOutColumn": string
    /** 新しいウィンドウを開く */
    readonly "newWindow": string
    /** すべてのサブウィンドウを閉じる */
    readonly "closeAllWindows": string
    /** PiPウィンドウを開く */
    readonly "pipWindow": string
    /** 開発者ツール */
    readonly "devtools": string
    /** プロファイルエディタ */
    readonly "profileEditor": string
    /** {name} に切替 */
    readonly "switchProfile": ParameterizedString<'name'>
  }
  readonly "_capabilities": {
    readonly "account": {
      /** 現在のアカウント情報 */
      readonly "current": string
      /** アカウント一覧 */
      readonly "list": string
    }
    readonly "ai": {
      /** AI に問い合わせる */
      readonly "chat": string
      /** persona 用 skill 一覧 */
      readonly "listPersonas": string
      readonly "sessions": {
        /** AI セッション一覧 */
        readonly "list": string
        /** AI セッションを読む */
        readonly "read": string
        /** AI セッション本文を検索 */
        readonly "search": string
      }
      /** AI persona を切替 */
      readonly "setPersona": string
    }
    readonly "aiscript": {
      /** AiScript 実行ログを取得 */
      readonly "logs": string
      /** AiScript を構文検証する */
      readonly "validate": string
    }
    readonly "announcements": {
      /** サーバーアナウンス一覧 */
      readonly "list": string
    }
    readonly "antenna": {
      /** 自分のアンテナ一覧 */
      readonly "list": string
      /** アンテナの note */
      readonly "notes": string
    }
    readonly "backup": {
      /** バックアップを作成 */
      readonly "create": string
    }
    readonly "channel": {
      /** 自分のフォロー中チャネル */
      readonly "list": string
      /** チャネルの note */
      readonly "notes": string
    }
    readonly "chat": {
      /** チャットメッセージにリアクション */
      readonly "react": string
      /** チャットメッセージのリアクションを解除 */
      readonly "unreact": string
    }
    readonly "clipboard": {
      /** クリップボードを読む */
      readonly "read": string
      /** クリップボードに書き込む */
      readonly "write": string
    }
    readonly "clips": {
      /** クリップにノートを追加 */
      readonly "addNote": string
      /** クリップを作成 */
      readonly "create": string
      /** クリップ一覧 */
      readonly "list": string
      /** クリップ内のノート一覧 */
      readonly "notes": string
      /** クリップからノートを削除 */
      readonly "removeNote": string
    }
    readonly "column": {
      /** アクティブなカラムを取得 */
      readonly "active": string
      /** カラムを追加 */
      readonly "add": string
      /** フォーカス中のノートを取得 */
      readonly "focusedNote": string
      /** カラム一覧 */
      readonly "list": string
      /** カラムを移動 */
      readonly "move": string
      /** カラムを削除 */
      readonly "remove": string
      /** カラム設定を更新 */
      readonly "updateSettings": string
    }
    readonly "drafts": {
      /** 下書きを作成 */
      readonly "create": string
      /** 下書きを削除 */
      readonly "delete": string
      /** 下書き一覧 */
      readonly "list": string
      /** 下書きを更新 */
      readonly "update": string
    }
    readonly "drive": {
      /** ドライブファイル一覧 */
      readonly "list": string
    }
    readonly "favorites": {
      /** お気に入りに追加 */
      readonly "add": string
      /** お気に入りから削除 */
      readonly "remove": string
    }
    readonly "federation": {
      /** 連合チャート */
      readonly "chart": string
      /** 連合先インスタンス詳細 */
      readonly "instance": string
      /** 連合先インスタンス一覧 */
      readonly "instances": string
    }
    readonly "files": {
      /** ファイルをローカルに保存 */
      readonly "export": string
    }
    readonly "flash": {
      /** Misskey Play 一覧 */
      readonly "list": string
      /** Misskey Play 詳細 */
      readonly "show": string
    }
    readonly "gallery": {
      /** Gallery 一覧 */
      readonly "list": string
    }
    readonly "heartbeat": {
      /** HEARTBEAT の報告 */
      readonly "report": string
    }
    readonly "http": {
      /** 外部 HTTP リクエスト */
      readonly "fetch": string
    }
    readonly "keybinds": {
      /** キーバインド一覧 */
      readonly "list": string
      /** キーバインドを default に戻す */
      readonly "reset": string
      /** 全キーバインドを default に戻す */
      readonly "resetAll": string
      /** キーバインドを設定 */
      readonly "set": string
    }
    readonly "list": {
      /** リストにユーザーを追加 */
      readonly "addUser": string
      /** 自分のリスト一覧 */
      readonly "list": string
      /** リストからユーザーを削除 */
      readonly "removeUser": string
    }
    readonly "logs": {
      /** 最近のログを取得 */
      readonly "recent": string
    }
    readonly "memos": {
      /** メモのバックリンク */
      readonly "backlinks": string
      /** メモを作成 */
      readonly "create": string
      /** メモを削除 */
      readonly "delete": string
      /** メモを列挙 */
      readonly "list": string
      /** メモを過去の状態に戻す */
      readonly "revert": string
      /** メモを検索 */
      readonly "search": string
      /** メモを更新 */
      readonly "update": string
    }
    readonly "meta": {
      /** active な skill 一覧 */
      readonly "activeSkills": string
      /** 現在の AI 設定スナップショット */
      readonly "config": string
      /** HEARTBEAT 設定スナップショット */
      readonly "heartbeat": string
      /** 現在の permission を取得 */
      readonly "permissions": string
      /** 現在の AI persona */
      readonly "persona": string
    }
    readonly "metrics": {
      /** 実行時メトリクスを取得 */
      readonly "read": string
    }
    readonly "misstore": {
      /** MisStore を検索 */
      readonly "search": string
    }
    readonly "navbar": {
      /** ナビバー構成を読む */
      readonly "list": string
      /** ナビバー構成を default に戻す */
      readonly "reset": string
      /** ナビバー構成を上書き */
      readonly "set": string
    }
    readonly "notes": {
      /** リプライ取得 */
      readonly "children": string
      /** ノートを投稿 */
      readonly "create": string
      /** ノートを削除 */
      readonly "delete": string
      /** ノートをプロファイルに pin */
      readonly "pin": string
      /** リアクションする */
      readonly "react": string
      /** ノート検索 */
      readonly "search": string
      /** 手元の索引を検索 */
      readonly "searchArchive": string
      /** ノート取得 */
      readonly "show": string
      /** タイムライン取得 */
      readonly "timeline": string
      /** ノートの pin を解除 */
      readonly "unpin": string
      /** リアクションを解除 */
      readonly "unreact": string
      /** ユーザーのノート取得 */
      readonly "user": string
    }
    readonly "notifications": {
      /** 通知一覧 */
      readonly "list": string
      /** 通知をすべて既読化 */
      readonly "markRead": string
    }
    readonly "pages": {
      /** Pages 一覧 */
      readonly "list": string
      /** Page 詳細 */
      readonly "show": string
    }
    readonly "performance": {
      /** パフォーマンススライダーを適用 */
      readonly "applySlider": string
      /** パフォーマンス設定一覧 */
      readonly "list": string
      /** パフォーマンス値を default に戻す */
      readonly "reset": string
      /** 全パフォーマンス値を default に戻す */
      readonly "resetAll": string
      /** パフォーマンス値を設定 */
      readonly "set": string
    }
    readonly "plugins": {
      /** プラグインを作成 */
      readonly "create": string
      /** プラグインを削除 */
      readonly "delete": string
      /** プラグインの編集履歴 */
      readonly "history": string
      /** MisStore からプラグインを入れる */
      readonly "install": string
      /** プラグイン一覧 */
      readonly "list": string
      /** プラグインの AiScript を読む */
      readonly "read": string
      /** プラグインを過去の状態に戻す */
      readonly "revert": string
      /** プラグインの有効/無効を切替 */
      readonly "setActive": string
      /** プラグインを削除 */
      readonly "uninstall": string
      /** プラグインの AiScript を更新 */
      readonly "update": string
    }
    readonly "queries": {
      /** クエリの編集履歴 */
      readonly "history": string
      /** クエリを過去の状態に戻す */
      readonly "revert": string
    }
    readonly "registry": {
      /** registry の値を削除 */
      readonly "delete": string
      /** registry の値を取得 */
      readonly "get": string
      /** registry の key 一覧 */
      readonly "listKeys": string
      /** registry に値を書込 */
      readonly "set": string
    }
    readonly "role": {
      /** ロールの note */
      readonly "notes": string
    }
    readonly "sidebar": {
      /** サイドバーで開閉 */
      readonly "toggle": string
    }
    readonly "skills": {
      /** スキル本文に追記 */
      readonly "append": string
      /** スキルを作成 */
      readonly "create": string
      /** スキルの編集履歴を取得 */
      readonly "history": string
      /** MisStore からスキルを入れる */
      readonly "install": string
      /** スキル一覧 */
      readonly "list": string
      /** スキル本文を読む */
      readonly "read": string
      /** スキルのセクションを置換 */
      readonly "replaceSection": string
      /** スキルを過去の編集前状態に戻す */
      readonly "revert": string
      /** スキルの有効/無効を切替 */
      readonly "toggle": string
      /** スキルを削除 */
      readonly "uninstall": string
    }
    readonly "styles": {
      /** カスタム CSS に追記 */
      readonly "append": string
      /** カスタム CSS の編集履歴 */
      readonly "history": string
      /** カスタム CSS を読む */
      readonly "read": string
      /** カスタム CSS を過去の状態に戻す */
      readonly "revert": string
      /** カスタム CSS を全置換 */
      readonly "write": string
    }
    readonly "tasks": {
      /** タスク実行 */
      readonly "run": string
    }
    readonly "theme": {
      /** テーマを適用 */
      readonly "apply": string
      /** テーマを作成 */
      readonly "create": string
      /** テーマの編集履歴 */
      readonly "history": string
      /** MisStore からテーマを入れる */
      readonly "install": string
      /** テーマ一覧 */
      readonly "list": string
      /** テーマの内容を読む */
      readonly "read": string
      /** テーマを過去の状態に戻す */
      readonly "revert": string
      /** テーマを削除 */
      readonly "uninstall": string
      /** テーマを更新 */
      readonly "update": string
    }
    readonly "time": {
      /** 現在時刻を取得 */
      readonly "now": string
    }
    readonly "ui": {
      /** デスクトップ通知 */
      readonly "notify": string
    }
    readonly "user": {
      /** ユーザーをフォロー */
      readonly "follow": string
      /** フォロワー一覧 */
      readonly "followers": string
      /** フォロー一覧 */
      readonly "following": string
      /** ユーザー検索 */
      readonly "lookup": string
      /** ユーザーをミュート */
      readonly "mute": string
      /** リノートだけミュート */
      readonly "renoteMute": string
      /** ユーザーをあいまい検索 */
      readonly "search": string
      /** ユーザーのフォローを解除 */
      readonly "unfollow": string
      /** ユーザーのミュートを解除 */
      readonly "unmute": string
      /** リノートミュートを解除 */
      readonly "unrenoteMute": string
    }
    readonly "vault": {
      /** Vault 接続で HTTP リクエスト */
      readonly "fetch": string
    }
    readonly "widgets": {
      /** ウィジェットを作成 */
      readonly "create": string
      /** ウィジェットを削除 */
      readonly "delete": string
      /** ウィジェットの編集履歴 */
      readonly "history": string
      /** MisStore からウィジェットを入れる */
      readonly "install": string
      /** ウィジェット一覧 */
      readonly "list": string
      /** ウィジェットの AiScript を読む */
      readonly "read": string
      /** ウィジェットを過去の状態に戻す */
      readonly "revert": string
      /** ウィジェットの自動実行を切替 */
      readonly "setAutoRun": string
      /** ウィジェットを削除 */
      readonly "uninstall": string
      /** ウィジェットの AiScript を更新 */
      readonly "update": string
    }
    readonly "windows": {
      /** ウィンドウを閉じる */
      readonly "close": string
      /** 全ウィンドウを閉じる */
      readonly "closeAll": string
      /** ウィンドウを前面に */
      readonly "focus": string
      /** 開いているウィンドウ一覧 */
      readonly "list": string
      /** ウィンドウを開く */
      readonly "open": string
    }
  }
}

export const LANGUAGES = [
  {
    "code": "ja-JP",
    "name": "日本語",
    "published": true
  },
  {
    "code": "en-US",
    "name": "English",
    "published": false
  }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const LOCALE_LOADERS: Record<
  LanguageCode,
  () => Promise<{ default: Locale }>
> = {
  'ja-JP': () => import('virtual:nd-locale/ja-JP'),
  'en-US': () => import('virtual:nd-locale/en-US'),
}
