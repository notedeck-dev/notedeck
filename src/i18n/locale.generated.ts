// 生成物 — 編集しない。locales/ から `pnpm gen:i18n` で作る (#135)

import type { ParameterizedString, PluralString } from './types'

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
    /** Misskey について */
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
    /** API コンソール */
    readonly "apiConsole": string
    /** API ドキュメント */
    readonly "apiDocs": string
    /** ストリーム */
    readonly "streamInspector": string
    /** タスク */
    readonly "taskRunner": string
  }
  readonly "_columnGroups": {
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
    /** カスタム CSS */
    readonly "cssEditor": string
    /** テーマ */
    readonly "themeEditor": string
    /** プロファイルエディター */
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
    /** カラムを追加 */
    readonly "addColumn": string
    /** カラムを左に移動 */
    readonly "moveColumnLeft": string
    /** カラムを右に移動 */
    readonly "moveColumnRight": string
    /** サイドバー切り替え */
    readonly "toggleSidebar": string
    /** ウィンドウを隠す */
    readonly "bossKey": string
    /** アカウントメニュー */
    readonly "accountMenu": string
    /** プロファイル切り替え */
    readonly "profileMenu": string
    /** 設定メニュー */
    readonly "settingsMenu": string
    /** チュートリアル */
    readonly "tutorial": string
    /** ダーク/ライトモード切り替え */
    readonly "toggleDarkMode": string
    /** オフラインモード切り替え */
    readonly "toggleOfflineMode": string
    /** リアルタイムモード切り替え */
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
    /** お気に入り */
    readonly "noteBookmark": string
    /** ノートを開く */
    readonly "noteOpen": string
    /** CW 切り替え */
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
    /** カラムのミュート切り替え */
    readonly "toggleColumnMute": string
    /** キーバインド設定 */
    readonly "keybinds": string
    /** カスタム CSS */
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
    /** AI アシスタント */
    readonly "ai": string
    /** フローティングウィンドウをすべて閉じる */
    readonly "closeAllFloatingWindows": string
    /** カラムを別ウィンドウにポップアウト */
    readonly "popOutColumn": string
    /** 新しいウィンドウを開く */
    readonly "newWindow": string
    /** すべてのサブウィンドウを閉じる */
    readonly "closeAllWindows": string
    /** PiP ウィンドウを開く */
    readonly "pipWindow": string
    /** 開発者ツール */
    readonly "devtools": string
    /** プロファイルエディター */
    readonly "profileEditor": string
    /** {name} に切り替え */
    readonly "switchProfile": ParameterizedString<'name'>
  }
  readonly "_common": {
    /** 再試行 */
    readonly "retry": string
    /** キャンセル */
    readonly "cancel": string
    /** 削除 */
    readonly "delete": string
    /** 閉じる */
    readonly "close": string
    /** 無効 */
    readonly "disabled": string
    /** 読み込み中... */
    readonly "loading": string
    /** インポート */
    readonly "import": string
    /** エクスポート */
    readonly "export": string
    /** コピー済み */
    readonly "copied": string
    /** コピーしました */
    readonly "copiedToClipboard": string
    /** コード */
    readonly "code": string
    /** ビジュアル */
    readonly "visual": string
    /** 戻る */
    readonly "back": string
    /** メニュー */
    readonly "menu": string
    /** 読み込み済み */
    readonly "loaded": string
    /** リセットしますか？ */
    readonly "confirmReset": string
    /** 隠す */
    readonly "hide": string
    /** 保存 */
    readonly "save": string
    /** 保存しました */
    readonly "saved": string
    /** 名前を変更 */
    readonly "rename": string
    /** デフォルトに戻す */
    readonly "resetToDefault": string
    /** すべてリセット */
    readonly "resetAll": string
    /** 編集 */
    readonly "edit": string
    /** 追加 */
    readonly "add": string
    /** 送信 */
    readonly "send": string
    /** クリア */
    readonly "clear": string
    /** 設定 */
    readonly "settings": string
    /** 概要 */
    readonly "overview": string
    /** 有効にする */
    readonly "enable": string
    /** 無効にする */
    readonly "disable": string
    /** インストール */
    readonly "install": string
    /** インストール済み */
    readonly "installed": string
    /** 更新あり */
    readonly "updateAvailable": string
    /** 適用中 */
    readonly "active": string
    /** ビジュアルに同期 */
    readonly "syncToVisual": string
    /** ローカル */
    readonly "local": string
    /** オフライン */
    readonly "offline": string
    /** ポーリング */
    readonly "polling": string
    /** ストア */
    readonly "store": string
    /** ストアに接続できません */
    readonly "storeUnavailable": string
    /** ストアを探す */
    readonly "browseStore": string
    /** MisStore で詳細を開く */
    readonly "openInMisStore": string
    /** ソース欠損 */
    readonly "sourceMissing": string
    /** ライブラリから追加 */
    readonly "addFromLibrary": string
    /** 離してリフレッシュ */
    readonly "releaseToRefresh": string
    /** リフレッシュ中... */
    readonly "refreshing": string
    /** アカウント */
    readonly "account": string
    /** アカウントが見つかりません */
    readonly "accountNotFound": string
    /** 全アカウント */
    readonly "allAccounts": string
    /** キャッシュ削除 */
    readonly "clearCache": string
    /** コピー */
    readonly "copy": string
    /** コードをコピー */
    readonly "copyCode": string
    /** デフォルト */
    readonly "default": string
    /** データを削除 */
    readonly "deleteData": string
    /** {label}を削除 */
    readonly "deleteItem": ParameterizedString<'label'>
    /** このアカウントから外す */
    readonly "detachFromAccount": string
    /** 絵文字 */
    readonly "emoji": string
    /** フォロワー */
    readonly "followers": string
    /** フォローされています */
    readonly "followsYou": string
    /** ハッシュタグ */
    readonly "hashtag": string
    /** 履歴 */
    readonly "history": string
    /** ホーム */
    readonly "home": string
    /** インストールに失敗しました */
    readonly "installFailed": string
    /** インストール済み {count} */
    readonly "installedTab": ParameterizedString<'count'>
    /** 無効 */
    readonly "invalid": string
    /** 不正な JSON5 */
    readonly "invalidJson5": string
    /** JSON5 パースエラー */
    readonly "json5ParseError": string
    /** ログアウト */
    readonly "logout": string
    /** メモ */
    readonly "memo": string
    /** メンション */
    readonly "mention": string
    /** ミュート */
    readonly "mute": string
    /** {emoji} (ミュート中) */
    readonly "mutedEmoji": ParameterizedString<'emoji'>
    /** {reaction} (ミュート中) */
    readonly "mutedReaction": ParameterizedString<'reaction'>
    /** 新規フォルダ */
    readonly "newFolder": string
    /** 新しいノート */
    readonly "newNotes": string
    /** ノート */
    readonly "note": string
    /** ノート */
    readonly "notes": string
    /** 非公開 */
    readonly "private": string
    /** プロファイル */
    readonly "profile": string
    /** 下に引いてリフレッシュ */
    readonly "pullToRefresh": string
    /** 引用 */
    readonly "quote": string
    /** {endpoint} の生レスポンス */
    readonly "rawResponse": ParameterizedString<'endpoint'>
    /** リアクション */
    readonly "react": string
    /** リアクション */
    readonly "reactions": string
    /** リロード */
    readonly "reload": string
    /** 再ログイン */
    readonly "relogin": string
    /** 解除 */
    readonly "remove": string
    /** リノート */
    readonly "renote": string
    /** リノート */
    readonly "renotes": string
    /** 返信 */
    readonly "reply": string
    /** 通報 */
    readonly "report": string
    /** 通報に失敗しました ({code}) */
    readonly "reportFailed": ParameterizedString<'code'>
    /** 通報理由を入力... */
    readonly "reportReasonPlaceholder": string
    /** @{username} を通報 */
    readonly "reportUser": ParameterizedString<'username'>
    /** 通報しました */
    readonly "reported": string
    /** すべてデフォルトに戻す */
    readonly "resetAllToDefault": string
    /** 実行 */
    readonly "run": string
    /** 保存中... */
    readonly "saving": string
    /** {label}を検索... */
    readonly "searchItem": ParameterizedString<'label'>
    /** サーバー */
    readonly "server": string
    /** サイドロード */
    readonly "sideload": string
    /** ストア配布 */
    readonly "storeDistributed": string
    /** ストア更新日: {date} */
    readonly "storeUpdated": ParameterizedString<'date'>
    /** ストア更新日: {date} / v{version} */
    readonly "storeUpdatedWithVersion": ParameterizedString<'date' | 'version'>
    /** 切り替え */
    readonly "switch": string
    /** 元に戻す */
    readonly "undo": string
    /** ミュート解除 */
    readonly "unmute": string
    /** 更新 */
    readonly "update": string
    /** 更新に失敗しました */
    readonly "updateFailed": string
    /** ユーザー */
    readonly "users": string
    /** 不明なエラー */
    readonly "unknownError": string
  }
  readonly "_appConfirm": {
    /** NoteDeck の権限確認 */
    readonly "trustedHeader": string
  }
  readonly "_commandPalette": {
    /** 一致する項目がありません */
    readonly "noMatchingItems": string
    /** ↵ Enter で開く: */
    readonly "enterToOpen": string
    /** ↵ Enter で実行: */
    readonly "enterToRun": string
    /** 一致するコマンドがありません */
    readonly "noMatchingCommands": string
    /** 全般 */
    readonly "categoryGeneral": string
    /** ナビゲーション */
    readonly "categoryNavigation": string
    /** カラム */
    readonly "categoryColumn": string
    /** コマンドを入力... */
    readonly "inputPlaceholder": string
  }
  readonly "_crossAccountProgress": {
    /** {total} アカウントのうち {pending} 件待ち */
    readonly "waiting": ParameterizedString<'pending' | 'total'>
  }
  readonly "_driveItemMenu": {
    /** 開く */
    readonly "open": string
    /** リネーム */
    readonly "rename": string
    /** 移動 */
    readonly "move": string
  }
  readonly "_galleryItemMenu": {
    /** 開く */
    readonly "open": string
    /** リンクをコピー */
    readonly "copyLink": string
    /** ブラウザーで開く */
    readonly "openInBrowser": string
  }
  readonly "_memoCard": {
    /** もっと見る */
    readonly "showMore": string
    /** ({count} 文字) */
    readonly "chars_plural": PluralString<'count'>
  }
  readonly "_mkAchievementsGrid": {
    /** 開放する */
    readonly "unlock": string
  }
  readonly "_mkAd": {
    /** この広告の表示頻度を下げる */
    readonly "showLess": string
  }
  readonly "_mkAutocompletePopup": {
    /** 検索中... */
    readonly "searching": string
  }
  readonly "_mkChatMessageMoreMenu": {
    /** このメッセージを削除しますか？ */
    readonly "confirmDelete": string
    /** 内容をコピー */
    readonly "copyContent": string
  }
  readonly "_mkDraftsPicker": {
    /** 下書きをすべて削除 */
    readonly "deleteAll": string
    /** 予約投稿はありません */
    readonly "noScheduled": string
    /** 下書きはありません */
    readonly "noDrafts": string
    /** この下書きを復元 */
    readonly "restoreThis": string
    /** 内容・時刻を編集 */
    readonly "editContentAndTime": string
    /** 復元して投稿フォームに反映 */
    readonly "restoreToForm": string
    /** 予約を取り消す */
    readonly "cancelSchedule": string
    /** 下書き */
    readonly "draftsTab": string
    /** 下書き {count} */
    readonly "draftsTabCount": ParameterizedString<'count'>
    /** 予約 */
    readonly "scheduledTab": string
    /** 予約 {count} */
    readonly "scheduledTabCount": ParameterizedString<'count'>
    /** チャンネル投稿 */
    readonly "contextChannel": string
    /** 予約投稿を取り消す */
    readonly "cancelScheduledTitle": string
    /** 下書きを削除 */
    readonly "deleteDraftTitle": string
    /** 選択した予約投稿を取り消しますか？ */
    readonly "confirmCancelScheduled": string
    /** 選択した下書きを削除しますか？ */
    readonly "confirmDeleteDraft": string
    /** 取り消す */
    readonly "cancelOk": string
    /** 予約投稿を取り消しました */
    readonly "scheduledCancelled": string
    /** 下書きを削除しました */
    readonly "draftDeleted": string
    /** 取り消しに失敗しました: {error} */
    readonly "cancelFailed": ParameterizedString<'error'>
    /** 削除に失敗しました: {error} */
    readonly "deleteFailed": ParameterizedString<'error'>
    /** 下書き {count} 件をすべて削除しますか？ (予約投稿は対象外) */
    readonly "confirmDeleteAll_plural": PluralString<'count'>
    /** すべて削除 */
    readonly "deleteAllOk": string
    /** 下書きをすべて削除しました */
    readonly "allDeleted": string
  }
  readonly "_mkDriveFolderSelectDialog": {
    /** ルート */
    readonly "root": string
    /** 「{name}」に移動 */
    readonly "moveTo": ParameterizedString<'name'>
    /** ルートに移動 */
    readonly "moveToRoot": string
  }
  readonly "_mkDrivePicker": {
    /** アップロード */
    readonly "upload": string
    /** ファイルを選択 */
    readonly "selectFiles": string
    /** {count} 件を添付 */
    readonly "attachCount_plural": PluralString<'count'>
    /** 添付 */
    readonly "attach": string
  }
  readonly "_mkFileGrid": {
    /** 「{name}」のメニュー */
    readonly "menuFor": ParameterizedString<'name'>
  }
  readonly "_mkFolderGrid": {
    /** 「{name}」のメニュー */
    readonly "menuFor": ParameterizedString<'name'>
  }
  readonly "_mkMediaGrid": {
    /** 動画をタップで読み込み */
    readonly "tapToLoadVideo": string
    /** 画像をタップで読み込み */
    readonly "tapToLoadImage": string
  }
  readonly "_mkMediaLightbox": {
    /** 画像をコピー */
    readonly "copyImage": string
    /** 画像をダウンロード */
    readonly "downloadImage": string
    /** 画像のリンクをコピー */
    readonly "copyImageLink": string
    /** 画像を共有 */
    readonly "shareImage": string
    /** ブラウザーで開く */
    readonly "openInBrowser": string
  }
  readonly "_mkNote": {
    /** ピン留めされたノート */
    readonly "pinned": string
    /** がリノート */
    readonly "renotedSuffix": string
    /** {mode}モード */
    readonly "modeTitle": ParameterizedString<'mode'>
    /** ローカルのみ */
    readonly "localOnly": string
    /** {name}が何かを言いました */
    readonly "saidSomething": ParameterizedString<'name'>
    /** もっと見る */
    readonly "showMore": string
    /** このノートは非公開です */
    readonly "contentHidden": string
    /** ({count} 文字) */
    readonly "chars_plural": PluralString<'count'>
    /** リアクションを取り消す */
    readonly "unreact": string
    /** リノート解除 */
    readonly "unrenote": string
    /** {count} サーバーで表示中 */
    readonly "shownOnServers_plural": PluralString<'count'>
    /** {count} アカウントで表示中 */
    readonly "shownOnAccounts_plural": PluralString<'count'>
    /** {names} が反応済み */
    readonly "reactedBy": ParameterizedString<'names'>
    /** このサーバーではリモートの絵文字でリアクションできません */
    readonly "joinBlockedUnsupportedServer": string
    /** この絵文字はサーバーにないためリアクションできません */
    readonly "joinBlockedEmojiUnavailable": string
    /** リアクションに失敗しました */
    readonly "reactionFailed": string
  }
  readonly "_mkNoteTree": {
    /** スレッドを続ける */
    readonly "continueThread": string
  }
  readonly "_mkPoll": {
    /** {count} 票 */
    readonly "votes_plural": PluralString<'count'>
    /** 複数選択 */
    readonly "multiple": string
    /** 終了 */
    readonly "ended": string
    /** {date}まで */
    readonly "until": ParameterizedString<'date'>
  }
  readonly "_mkPostForm": {
    /** ゲスト */
    readonly "guest": string
    /** ローカルのみ (連合なし) */
    readonly "localOnly": string
    /** 連合あり */
    readonly "federated": string
    /** その他 */
    readonly "more": string
    /** プレビュー */
    readonly "preview": string
    /** 公開範囲を記憶 */
    readonly "rememberVisibility": string
    /** 予約投稿 */
    readonly "scheduledPost": string
    /** 予約 */
    readonly "schedule": string
    /** 引用付き */
    readonly "withQuote": string
    /** チャンネルに投稿 */
    readonly "postToChannel": string
    /** 閲覧注意 */
    readonly "cw": string
    /** 返信... */
    readonly "replyPlaceholder": string
    /** 引用... */
    readonly "quotePlaceholder": string
    /** 今どんな気分？ */
    readonly "placeholder": string
    /** 予約を取り消す */
    readonly "unschedule": string
    /** アカウントが選択されていません */
    readonly "noAccountSelected": string
    /** ファイルを添付 */
    readonly "attachFile": string
    /** 投票 */
    readonly "poll": string
    /** 下書き一覧 */
    readonly "drafts": string
    /** プラグイン */
    readonly "plugins": string
    /** ボタン並び替え */
    readonly "reorderButtons": string
    /** メモを自動保存 */
    readonly "autoSaveMemo": string
    /** 下書きを自動保存 */
    readonly "autoSaveDraft": string
    /** 書きかけのメモがあります */
    readonly "unsavedMemoTitle": string
    /** 書きかけの投稿があります */
    readonly "unsavedPostTitle": string
    /** 閉じる前にメモとして保存しますか？ */
    readonly "saveAsMemoBeforeClose": string
    /** 閉じる前に下書きとして保存しますか？ */
    readonly "saveAsDraftBeforeClose": string
    /** 保存して閉じる */
    readonly "saveAndClose": string
    /** 破棄 */
    readonly "discard": string
  }
  readonly "_mkPostFormButtonsPicker": {
    /** 投稿フォームボタン */
    readonly "title": string
  }
  readonly "_mkReactionPicker": {
    /** 絵文字を検索... */
    readonly "searchPlaceholder": string
    /** 絵文字が見つかりません */
    readonly "notFound": string
    /** 最近使った絵文字 */
    readonly "recent": string
    /** その他 */
    readonly "uncategorized": string
  }
  readonly "_mkReactionUsersPopup": {
    /** この絵文字をミュート */
    readonly "muteEmoji": string
  }
  readonly "_mkUserListItem": {
    /** ブロック中 */
    readonly "blocking": string
    /** ミュート中 */
    readonly "muted": string
  }
  readonly "_mkUserPopup": {
    /** {count} ノート */
    readonly "notesCount": ParameterizedString<'count'>
    /** {count} フォロー */
    readonly "followingCount": ParameterizedString<'count'>
    /** {count} フォロワー */
    readonly "followersCount": ParameterizedString<'count'>
    /** リモートユーザー */
    readonly "remoteUser": string
  }
  readonly "_noteMoreMenu": {
    /** このノートを削除しますか？ */
    readonly "confirmDelete": string
    /** このノートを削除して再編集しますか？ */
    readonly "confirmDeleteAndEdit": string
    /** 削除して編集 */
    readonly "deleteAndEdit": string
    /** お気に入り解除 */
    readonly "unfavorite": string
    /** お気に入り */
    readonly "favorite": string
    /** クリップに追加 */
    readonly "addToClip": string
    /** 別のアカウントで... */
    readonly "actAs": string
    /** Raw JSON を表示 */
    readonly "showRawJson": string
    /** 内容をコピー */
    readonly "copyContent": string
    /** リンクをコピー */
    readonly "copyLink": string
    /** 共有 */
    readonly "share": string
    /** ピン留め解除 */
    readonly "unpin": string
    /** ピン留め */
    readonly "pin": string
    /** このノートを操作するアカウント */
    readonly "actAsDescription": string
    /** このアカウントでは本文が非公開のため操作できません */
    readonly "contentHiddenForAccount": string
    /** リアクションを取り消す ({reaction}) */
    readonly "unreactWith": ParameterizedString<'reaction'>
    /** クリップに追加しました */
    readonly "addedToClip": string
    /** クリップ解除 */
    readonly "removeFromClipTitle": string
    /** このノートは既に「{clip}」にクリップされています。クリップを解除しますか？ */
    readonly "confirmRemoveFromClip": ParameterizedString<'clip'>
    /** クリップから解除しました */
    readonly "removedFromClip": string
    /** クリップの解除に失敗しました ({code}) */
    readonly "removeFromClipFailed": ParameterizedString<'code'>
    /** クリップへの追加に失敗しました ({code}) */
    readonly "addToClipFailed": ParameterizedString<'code'>
    /** 新しいクリップを作成 */
    readonly "createClip": string
    /** クリップ名を入力... */
    readonly "clipNamePlaceholder": string
    /** クリップの作成に失敗しました ({code}) */
    readonly "createClipFailed": ParameterizedString<'code'>
    /** アカウントを選択... */
    readonly "selectAccountPlaceholder": string
    /** クリップを選択... */
    readonly "selectClipPlaceholder": string
    /** クリップの取得に失敗しました ({code}) */
    readonly "fetchClipsFailed": ParameterizedString<'code'>
  }
  readonly "_noteReactionPickerPopup": {
    /** {account} として */
    readonly "actingAs": ParameterizedString<'account'>
  }
  readonly "_noteReactionUsersModal": {
    /** リアクションなし */
    readonly "noReactions": string
  }
  readonly "_noteVariantsPopup": {
    /** このノートが見えているアカウント */
    readonly "ariaLabel": string
    /** 見えているアカウント */
    readonly "title": string
    /** 表示中の視点 */
    readonly "primaryTitle": string
    /** 表示中 */
    readonly "primary": string
    /** このノートが最初に投稿されたサーバー */
    readonly "originTitle": string
    /** このアカウントでは本文が非公開 */
    readonly "contentHiddenTitle": string
    /** このアカウントで反応済み */
    readonly "reactedTitle": string
  }
  readonly "_rawJsonView": {
    /** 機密を隠す */
    readonly "hideSensitive": string
    /** 機密を表示 */
    readonly "showSensitive": string
    /** 表示中の JSON をコピー */
    readonly "copyJson": string
    /** データがありません */
    readonly "noData": string
  }
  readonly "_regexGuide": {
    /** フィルター条件 */
    readonly "filterConditions": string
    /** カンマ区切りで単語を入力 */
    readonly "wordsPlaceholder": string
    /** 条件を追加 */
    readonly "addCondition": string
    /** 適用 */
    readonly "apply": string
    /** いずれかを含む */
    readonly "containsAny": string
    /** すべてを含む */
    readonly "containsAll": string
    /** 除外する */
    readonly "excludes": string
  }
  readonly "_renoteMoreMenu": {
    /** このリノートを削除しますか？ */
    readonly "confirmDelete": string
    /** リノートの詳細 */
    readonly "details": string
    /** リノートのリンクをコピー */
    readonly "copyLink": string
    /** リノート削除 */
    readonly "deleteRenote": string
    /** リノートを通報 */
    readonly "reportRenote": string
    /** 削除に失敗しました ({code}) */
    readonly "deleteFailed": ParameterizedString<'code'>
  }
  readonly "_reorderableList": {
    /** 項目なし */
    readonly "empty": string
  }
  readonly "_safeModeNotice": {
    /** セーフモードで起動中のため{subject}は適用されていません。編集内容は保存され、通常起動で適用されます。 */
    readonly "notice": ParameterizedString<'subject'>
  }
  readonly "_titleBar": {
    /** 進む */
    readonly "forward": string
    /** 新しいウィンドウ */
    readonly "newWindow": string
    /** ピクチャーインピクチャー */
    readonly "pip": string
    /** デスクトップサイズ */
    readonly "desktopSize": string
    /** モバイルサイズ */
    readonly "mobileSize": string
    /** 最小化 */
    readonly "minimize": string
    /** 最大化 */
    readonly "maximize": string
  }
  readonly "_titleBarMenu": {
    /** ファイル */
    readonly "file": string
    /** 設定フォルダを開く */
    readonly "openSettingsFolder": string
    /** ログフォルダを開く */
    readonly "openLogFolder": string
    /** ダウンロードフォルダを開く */
    readonly "openDownloadFolder": string
    /** バックアップフォルダを開く */
    readonly "openBackupFolder": string
    /** OS 起動時に自動起動 */
    readonly "launchAtStartup": string
    /** 表示 */
    readonly "view": string
    /** 拡大 */
    readonly "zoomIn": string
    /** 縮小 */
    readonly "zoomOut": string
  }
  readonly "_postFormFilePreviews": {
    /** 破棄 */
    readonly "discard": string
    /** ファイル名を変更 */
    readonly "renameFile": string
    /** センシティブを解除 */
    readonly "unmarkSensitive": string
    /** センシティブとして設定 */
    readonly "markSensitive": string
    /** キャプションを編集 */
    readonly "editCaption": string
    /** キャプションを付ける */
    readonly "addCaption": string
    /** プレビュー */
    readonly "preview": string
    /** 添付を取り消す */
    readonly "removeAttachment": string
    /** キャプション */
    readonly "caption": string
    /** 視覚に障害のあるユーザーなどに向けたファイルの説明を設定できます */
    readonly "captionDescription": string
    /** ファイルの説明 */
    readonly "captionPlaceholder": string
  }
  readonly "_postFormPollEditor": {
    /** 選択肢 {n} */
    readonly "choicePlaceholder": ParameterizedString<'n'>
    /** 選択肢を追加 */
    readonly "addChoice": string
    /** 複数選択 */
    readonly "multiple": string
    /** 期限 */
    readonly "expiry": string
    /** 無期限 */
    readonly "noExpiry": string
    /** 日時指定 */
    readonly "specifyDate": string
    /** 30 分 */
    readonly "expiry30m": string
    /** 1 時間 */
    readonly "expiry1h": string
    /** 6 時間 */
    readonly "expiry6h": string
    /** 1 日 */
    readonly "expiry1d": string
    /** 3 日 */
    readonly "expiry3d": string
    /** 7 日 */
    readonly "expiry7d": string
  }
  readonly "_mkMfm": {
    /** 検索 */
    readonly "search": string
  }
  readonly "_app": {
    /** セーフモードで起動中 — プラグイン・ウィジェット・カスタム CSS・テーマ・HEARTBEAT は無効です */
    readonly "safeModeNotice": string
    /** オフにする */
    readonly "exitSafeMode": string
  }
  readonly "_devWelcome": {
    /** Misskey Pro — Misskey 廃人のための Misskey IDE */
    readonly "tagline": string
    /** デスクトップアプリとして起動してください */
    readonly "launchAsDesktopApp": string
    /** 起動を検知すると自動で Dev Dashboard に切り替わります */
    readonly "autoSwitchHint": string
  }
  readonly "_devDashboard": {
    /** アプリ接続なし — 再接続待ち... */
    readonly "appDisconnected": string
    /** ナビゲーションを開く */
    readonly "expandNav": string
    /** ナビゲーションを畳む */
    readonly "collapseNav": string
    /** リソース */
    readonly "resources": string
    /** API ドキュメント */
    readonly "apiDocs": string
    /** 実行中アプリのヘルスチェック — 127.0.0.1:19820 */
    readonly "overviewDesc": string
    /** 更新 */
    readonly "refresh": string
    /** デッキ — カラム {count} 本 */
    readonly "deckColumns_plural": PluralString<'count'>
    /** Raw データ */
    readonly "rawData": string
    /** 起動計測 */
    readonly "startup": string
    /** フロントの起動マークと WebView 起動固定費 (#985)。固定費は初回ナビゲーションのみ計測される */
    readonly "startupDesc": string
    /** 最終マークまで */
    readonly "untilLastMark": string
    /** WebView 起動固定費 */
    readonly "webviewFixedCost": string
    /** ウォーターフォール */
    readonly "waterfall": string
    /** 計測データなし — アプリ起動後に「更新」で取得します */
    readonly "noStartupData": string
    /** global daemon の観測面 (#411)。連続 3 回失敗で自動 disable する silent fail 防止機構つき */
    readonly "heartbeatDesc": string
    /** daemon (tick 実行中) */
    readonly "daemonTickRunning": string
    /** 最終 tick */
    readonly "lastTick": string
    /** 最終 tick ({source}) */
    readonly "lastTickWithSource": ParameterizedString<'source'>
    /** 連続失敗 */
    readonly "consecutiveFailures": string
    /** 本日の AI 起動 */
    readonly "aiRunsToday": string
    /** 設定と直近の結末 */
    readonly "configAndLastOutcome": string
    /** {minutes} 分 / {target} */
    readonly "intervalAndTarget": ParameterizedString<'minutes' | 'target'>
    /** 直近の結末 */
    readonly "lastOutcome": string
    /** 状態未取得 — アプリ接続後に自動で埋まります */
    readonly "noHeartbeatState": string
    /** キャッシュ観測 */
    readonly "caches": string
    /** 上限つきキャッシュの実測 (#987)。「必ず上限」の不変条件が守られているかをここで確かめる */
    readonly "cachesDesc": string
    /** 登録済みキャッシュなし — 名前付きキャッシュが生成されると現れます */
    readonly "noCaches": string
    /** Query Bridge トレース */
    readonly "qbTrace": string
    /** HTTP → WebView の query 往復と所要時間 (#897 の IPC 可視化)。エラー応答は赤、遅い往復は色付き */
    readonly "qbTraceDesc": string
    /** まだ記録なし — external API 経由の query が走ると溜まります */
    readonly "noQbTrace": string
    /** Inspector 照合 */
    readonly "inspector": string
    /** アダプタ層 (Misskey WS raw) と SSE (Rust イベントバス) の種別別カウントを突き合わせ、どの層までイベントが届いているかを切り分ける */
    readonly "inspectorDesc": string
    /** アダプタ層 (WS raw) */
    readonly "adapterLayer": string
    /** アダプタ層 (WS raw) — {count} 件 */
    readonly "adapterLayerCount_plural": PluralString<'count'>
    /** バッファ空 — Stream Inspector カラムを開くと流入します */
    readonly "bufferEmpty": string
    /** SSE (イベントバス) — {count} 件 */
    readonly "sseEventBusCount_plural": PluralString<'count'>
    /** 受信なし */
    readonly "nothingReceived": string
    /** SSE イベント */
    readonly "sseEvents": string
    /** /api/events — Rust イベントバスのライブストリーム · {count} events · {rate}/min */
    readonly "sseDesc": ParameterizedString<'count' | 'rate'>
    /** 直近 60 秒の流量 */
    readonly "last60sRate": string
    /** type prefix フィルター (例: note,notification,main-) */
    readonly "sseFilterPlaceholder": string
    /** 適用 / 再接続 */
    readonly "applyReconnect": string
    /** 停止 */
    readonly "stop": string
    /** バッファを JSON Lines でダウンロード */
    readonly "downloadJsonl": string
    /** クリックでこの種別に絞る */
    readonly "filterByType": string
    /** イベント待機中 — デッキにノートや通知が流れると表示されます */
    readonly "waitingForEvents": string
    /** external principal として dispatcher を通す手動実行盤 — 権限ゲート (#712) の deny / 確認ダイアログを目視テストできる · {count} 件 */
    readonly "capsDesc_plural": PluralString<'count'>
    /** capability を選択... */
    readonly "selectCapability": string
    /** 確認ダイアログあり (アプリ側に表示) */
    readonly "requiresConfirmation": string
    /** params スキーマ */
    readonly "paramsSchema": string
    /** パラメーターと実行 */
    readonly "paramsAndRun": string
    /** 実行中... */
    readonly "running": string
    /** 実行履歴 */
    readonly "runHistory": string
    /** クリックで結果を呼び戻す */
    readonly "restoreResult": string
    /** 実効権限 */
    readonly "effectivePermissions": string
    /** principal 別の granted マトリクス (#712)。Capabilities で選択すると要求キー行がハイライトされる */
    readonly "permsDesc": string
    /** principal 別の granted マトリクス (#712)。選択中の capability ({id}) の要求キー行をハイライト */
    readonly "permsDescSelected": ParameterizedString<'id'>
    /** 統合タイムライン */
    readonly "unifiedTimeline": string
    /** Rust ログ + SSE イベント + フロントログを単一時系列にマージ — どの層でイベントが消えたかを 1 画面で追う */
    readonly "unifiedTimelineDesc": string
    /** 絞り込み (部分一致) */
    readonly "logFilterPlaceholder": string
    /** WARN 以上のみ表示 (SSE イベントも隠れる) */
    readonly "warnOnly": string
    /** 再接続 */
    readonly "reconnect": string
    /** Rust ログ */
    readonly "rustLog": string
    /** フロント */
    readonly "front": string
    /** 待機中 — Rust ログ / SSE イベント / フロントログがここに時系列で流れます */
    readonly "waitingForLogs": string
    /** 観測 */
    readonly "navObserve": string
    /** 診断 */
    readonly "navDiagnose": string
    /** キャッシュ */
    readonly "navCaches": string
    /** {count} 時間前 */
    readonly "hoursAgo_plural": PluralString<'count'>
    /** {count} 分前 */
    readonly "minutesAgo_plural": PluralString<'count'>
  }
  readonly "_tutorialContent": {
    /** カテゴリを選んで始められます。一覧から進めてください。 */
    readonly "idleDescription": string
    /** 一覧を開く */
    readonly "openList": string
    /** チュートリアル {current} / {total} */
    readonly "progress": ParameterizedString<'current' | 'total'>
    /** 見直し */
    readonly "replaying": string
    /** ここまで完了しました */
    readonly "completedTitle": string
    /** チュートリアルの一覧から、続きのカテゴリを選べます。 */
    readonly "completedDescription": string
    /** 詳しく読む */
    readonly "readMore": string
    /** 達成しました */
    readonly "achieved": string
    /** スキップ */
    readonly "skip": string
    /** 次へ → */
    readonly "next": string
  }
  readonly "_aiConnectionSection": {
    /** AI 接続 */
    readonly "title": string
    /** 未選択 */
    readonly "notSelected": string
    /** API キーは Secret Vault (OS キーチェーン) に保管され、フロントエンドや AI には渡りません。接続の追加・編集は「接続」ウィンドウで行います。 */
    readonly "keyHint": string
    /** AI プロバイダー接続がありません。「接続」ウィンドウのテンプレートから接続を追加してください。 */
    readonly "noConnections": string
    /** 接続を追加 / 管理 */
    readonly "manageConnections": string
    /** モデル */
    readonly "model": string
    /** claude-sonnet-5, gpt-5.4-mini, moonshotai/kimi-k3 など */
    readonly "modelPlaceholder": string
  }
  readonly "_aiDataSourcesSection": {
    /** データソース */
    readonly "title": string
    /** メモの渡し方 */
    readonly "memosTitle": string
    /** リンク先メモを展開 */
    readonly "expandLinks": string
    /** 本文の `[name](memo:<id>)` で参照されているメモを 1 階層自動で AI に渡す。OFF にすると AI は明示的に `memos.backlinks` 等を呼ばない限り参照先を見ない。 */
    readonly "expandLinksDescription": string
    /** バックリンクを添付 */
    readonly "includeBacklinks": string
    /** 各メモに `referencedBy: [...]` を付けて「どのメモから参照されているか」を AI に伝える。 */
    readonly "includeBacklinksDescription": string
    /** 現在のアカウント */
    readonly "currentAccount": string
    /** ログイン中のアカウント情報を AI に渡す (トークン等は除外) */
    readonly "currentAccountDescription": string
    /** 現在のカラム */
    readonly "currentColumn": string
    /** フォーカス中のカラムの種別と設定を渡す */
    readonly "currentColumnDescription": string
    /** 可視アイテム (上限 10 件) */
    readonly "visibleNotes": string
    /** 画面に表示中のアイテム (ノート / 通知 / ドライブファイル等) を context に含める */
    readonly "visibleNotesDescription": string
    /** AI 会話履歴 (上限 20 ターン) */
    readonly "recentConversation": string
    /** 直近の会話を context に含める */
    readonly "recentConversationDescription": string
    /** ローカルメモ (上限 20 件) */
    readonly "memos": string
    /** Zettelkasten 形式のローカルメモを context に含める (現在のアカウントのみ) */
    readonly "memosDescription": string
    /** 標準 */
    readonly "memosStandard": string
    /** リンク展開のみ */
    readonly "memosLinksOnly": string
    /** バックリンクのみ */
    readonly "memosBacklinksOnly": string
    /** 本文のみ */
    readonly "memosBodyOnly": string
  }
  readonly "_aiGenerationSection": {
    /** 生成 */
    readonly "title": string
    /** デフォルトから変更あり */
    readonly "changedFromDefault": string
    /** デフォルトのまま使える値です。実行先のモデルによってデフォルトが合わないときだけ触ってください。 */
    readonly "note": string
    /** 応答の最大トークン */
    readonly "maxTokens": string
    /** 長い応答が途中で切れるときに上げます。0 でプロバイダーのデフォルトに任せます (Anthropic は上限必須のため {maxTokens} を送ります) */
    readonly "maxTokensHint": ParameterizedString<'maxTokens'>
    /** ツール呼び出しの上限 */
    readonly "maxToolRounds": string
    /** ラウンド */
    readonly "rounds": string
    /** 1 回の依頼で AI が続けてツールを呼べる回数。上げるほど込み入った作業を最後まで進められますが、費用と暴走したときの被害も比例して増えます */
    readonly "maxToolRoundsHint": string
    /** タイトル生成の最大トークン */
    readonly "titleMaxTokens": string
    /** セッション名が日付のまま残るときに上げます。この上限は思考にもかかる一方、タイトルとして使うのは本文だけなので、よく考えるモデルほど余裕が要ります */
    readonly "titleMaxTokensHint": string
    /** 応答待ちのタイムアウト */
    readonly "readTimeout": string
    /** 秒 */
    readonly "seconds": string
    /** 応答が届かなくなってからの待ち時間です。生成中は届き続けるので長考は切りません。最初の 1 文字までが遅い実行先 (ローカルの LLM など) で伸ばします */
    readonly "readTimeoutHint": string
  }
  readonly "_aiHeartbeatSection": {
    /** 有効・{minutes} 分 */
    readonly "enabledWithInterval": ParameterizedString<'minutes'>
    /** HEARTBEAT を有効化 */
    readonly "enable": string
    /** tick 間隔 */
    readonly "tickInterval": string
    /** 分 */
    readonly "minutes": string
    /** デスクトップ通知 */
    readonly "desktopNotification": string
    /** 重要発見 (HEARTBEAT_OK 以外) を OS 通知で表示。アプリにフォーカスがあれば自動抑制 */
    readonly "desktopNotificationDescription": string
    /** 変化なしなら AI を起動せず HEARTBEAT_OK 扱い (skill 側で cheapCheckCapabilities の宣言が必要) */
    readonly "cheapCheckDescription": string
    /** 最大連続 skip 時間 */
    readonly "maxSkipHours": string
    /** 時間 */
    readonly "hours": string
    /** 1 日の AI 起動上限 */
    readonly "dailyMaxAiRuns": string
    /** 回 / 日 */
    readonly "runsPerDay": string
    /** 上限到達時に自動停止 */
    readonly "disableOnDailyLimit": string
    /** OFF = 警告のみで継続 / ON = HEARTBEAT を自動 disable */
    readonly "disableOnDailyLimitDescription": string
    /** 1 日の token 予算 (現在の接続) */
    readonly "dailyTokenBudget": string
    /** tokens / 日 (0 = 無制限) */
    readonly "tokensPerDay": string
    /** HEARTBEAT 中の権限 */
    readonly "permissions": string
    /** 権限設定で変更 */
    readonly "changeInPermissions": string
  }
  readonly "_aiPersonaSection": {
    /** ペルソナ */
    readonly "title": string
    /** なし */
    readonly "none": string
    /** 新規セッションのデフォルトです。過去のセッションは作成時のペルソナを保持します。 */
    readonly "hint": string
    /** ペルソナ候補がありません。Skill 編集ウィンドウで「Persona」を ON にしたスキルがここに表示されます。 */
    readonly "noCandidates": string
  }
  readonly "_userProfileAchievementsPane": {
    /** 実績がありません */
    readonly "empty": string
  }
  readonly "_userProfileClipsPane": {
    /** クリップがありません */
    readonly "empty": string
  }
  readonly "_userProfileGalleryPane": {
    /** ギャラリー投稿がありません */
    readonly "empty": string
  }
  readonly "_userProfileListsPane": {
    /** リストがありません */
    readonly "empty": string
  }
  readonly "_userProfileNotesList": {
    /** ノートはありません */
    readonly "empty": string
    /** ハイライト */
    readonly "tabHighlight": string
    /** 全て */
    readonly "tabAll": string
    /** ファイル付き */
    readonly "tabFiles": string
  }
  readonly "_userProfilePagesPane": {
    /** ページがありません */
    readonly "empty": string
  }
  readonly "_userProfilePlayPane": {
    /** Play がありません */
    readonly "empty": string
  }
  readonly "_userProfileHero": {
    /** その他 */
    readonly "more": string
    /** QR コード */
    readonly "qrCode": string
    /** フォロワーへのメッセージ */
    readonly "followedMessage": string
    /** メモ (自分のみ) */
    readonly "memoHeading": string
    /** このユーザーへのメモを追加... */
    readonly "memoPlaceholder": string
    /** フォロー */
    readonly "following": string
    /** メモの保存に失敗しました ({code}) */
    readonly "memoSaveFailed": ParameterizedString<'code'>
  }
  readonly "_userProfileMenu": {
    /** ユーザー指定ノートを作成 */
    readonly "composeToUser": string
    /** ユーザーのノートを検索 */
    readonly "searchUserNotes": string
    /** ダイレクトメッセージ */
    readonly "directMessage": string
    /** ユーザー名をコピー */
    readonly "copyUsername": string
    /** プロフィール URL をコピー */
    readonly "copyProfileUrl": string
    /** RSS をコピー */
    readonly "copyRss": string
    /** 埋め込み */
    readonly "embed": string
    /** リストに追加 */
    readonly "addToList": string
    /** アンテナに追加 */
    readonly "addToAntenna": string
    /** TL に他の人への返信を含める */
    readonly "withReplies": string
    /** 投稿を通知 */
    readonly "notifyPosts": string
    /** リノートをミュート */
    readonly "muteRenotes": string
    /** リノートミュート解除 */
    readonly "unmuteRenotes": string
    /** ブロック */
    readonly "block": string
    /** ブロック解除 */
    readonly "unblock": string
    /** フォロワーを解除 */
    readonly "invalidateFollower": string
    /** @{username} をミュートしますか？ */
    readonly "muteConfirm": ParameterizedString<'username'>
    /** @{username} をブロックしますか？ */
    readonly "blockConfirm": ParameterizedString<'username'>
    /** @{username} のフォロワーを解除しますか？ */
    readonly "invalidateFollowerConfirm": ParameterizedString<'username'>
    /** リストがありません */
    readonly "noLists": string
    /** ユーザーソースのアンテナがありません */
    readonly "noUserAntennas": string
    /** ミュートしました */
    readonly "muted": string
    /** ミュートに失敗しました ({code}) */
    readonly "muteFailed": ParameterizedString<'code'>
    /** ミュートを解除しました */
    readonly "unmuted": string
    /** ミュート解除に失敗しました ({code}) */
    readonly "unmuteFailed": ParameterizedString<'code'>
    /** ブロックしました */
    readonly "blocked": string
    /** ブロックに失敗しました ({code}) */
    readonly "blockFailed": ParameterizedString<'code'>
    /** ブロックを解除しました */
    readonly "unblocked": string
    /** ブロック解除に失敗しました ({code}) */
    readonly "unblockFailed": ParameterizedString<'code'>
    /** リノートをミュートしました */
    readonly "renotesMuted": string
    /** リノートミュートに失敗しました ({code}) */
    readonly "renoteMuteFailed": ParameterizedString<'code'>
    /** リノートのミュートを解除しました */
    readonly "renotesUnmuted": string
    /** リノートミュート解除に失敗しました ({code}) */
    readonly "renoteUnmuteFailed": ParameterizedString<'code'>
    /** フォロワーを解除しました */
    readonly "followerInvalidated": string
    /** フォロワー解除に失敗しました ({code}) */
    readonly "invalidateFollowerFailed": ParameterizedString<'code'>
    /** 通報に失敗しました ({code}) */
    readonly "reportFailed": ParameterizedString<'code'>
    /** コピーに失敗しました */
    readonly "copyFailed": string
    /** ユーザー名をコピーしました */
    readonly "usernameCopied": string
    /** プロフィール URL をコピーしました */
    readonly "profileUrlCopied": string
    /** RSS の URL をコピーしました */
    readonly "rssUrlCopied": string
    /** 埋め込みコードをコピーしました */
    readonly "embedCodeCopied": string
    /** リストの取得に失敗しました ({code}) */
    readonly "fetchListsFailed": ParameterizedString<'code'>
    /** リストに追加しました */
    readonly "addedToList": string
    /** リストへの追加に失敗しました ({code}) */
    readonly "addToListFailed": ParameterizedString<'code'>
    /** TL に返信を含めます */
    readonly "withRepliesOn": string
    /** TL に返信を含めません */
    readonly "withRepliesOff": string
    /** 設定の更新に失敗しました ({code}) */
    readonly "updateSettingsFailed": ParameterizedString<'code'>
    /** 投稿を通知します */
    readonly "notifyOn": string
    /** 投稿を通知しません */
    readonly "notifyOff": string
    /** アンテナの取得に失敗しました ({code}) */
    readonly "fetchAntennasFailed": ParameterizedString<'code'>
    /** すでに追加されています */
    readonly "alreadyAdded": string
    /** {name} に追加しました */
    readonly "addedToAntenna": ParameterizedString<'name'>
    /** アンテナへの追加に失敗しました ({code}) */
    readonly "addToAntennaFailed": ParameterizedString<'code'>
    /** {acct} の検索 */
    readonly "searchColumnName": ParameterizedString<'acct'>
  }
  readonly "_notFoundPage": {
    /** ページが見つかりません */
    readonly "message": string
    /** ホームに戻る */
    readonly "backToHome": string
  }
  readonly "_pipPage": {
    /** 最前面固定を解除 */
    readonly "unpin": string
    /** 最前面に固定 */
    readonly "pin": string
    /** ノート Inspector */
    readonly "noteInspector": string
    /** 通知 Inspector */
    readonly "notificationInspector": string
    /** ログイン */
    readonly "login": string
    /** カスタム CSS */
    readonly "cssEditor": string
    /** 外観 */
    readonly "appearanceEditor": string
    /** タスク */
    readonly "tasksEditor": string
    /** ページ編集 */
    readonly "pageEdit": string
    /** Play 編集 */
    readonly "playEdit": string
  }
  readonly "_aiSettingsContent": {
    /** ai.json5 を直接編集できます。API キーはキーチェーン管理のため raw には現れません。 */
    readonly "rawHint": string
  }
  readonly "_appearanceEditorContent": {
    /** 壁紙を設定 */
    readonly "setWallpaper": string
    /** 壁紙を削除 */
    readonly "removeWallpaper": string
    /** Cat ユーザーの語尾をにゃ化 */
    readonly "nyaize": string
    /** 本家 Web UI と同じ表示。コピー・検索は原文のまま */
    readonly "nyaizeDescription": string
    /** デフォルト値からの差分のみ表示 — 変更は自動保存されます */
    readonly "codeHint": string
    /** トップレベルは JSON オブジェクト {} である必要があります */
    readonly "topLevelMustBeObject": string
    /** 不正な JSON */
    readonly "invalidJson": string
    /** 編集中... */
    readonly "editing": string
  }
  readonly "_backupContent": {
    /** 設定ファイル */
    readonly "settingsFiles": string
    /** テーマ・プラグイン・ウィジェット・スキル・プロファイル・各設定をひとつの notedeck.json にまとめてエクスポート / インポートします。 */
    readonly "settingsHint": string
    /** 処理中... */
    readonly "processing": string
    /** データベース */
    readonly "database": string
    /** ノート・通知・フォロー情報などのローカルキャッシュ DB をバックアップ / リストアします。 */
    readonly "databaseHint": string
    /** 認証情報は含まれないため、リストア後は各アカウントで再ログインしてください。 */
    readonly "databaseCredentialsNote": string
    /** バックアップ */
    readonly "backup": string
    /** リストア */
    readonly "restore": string
    /** 設定インポート完了 */
    readonly "importDoneTitle": string
    /** {count} 件のエントリをスキップまたは別名で復元しました。アプリを再起動します。 */
    readonly "importDoneMessage_plural": PluralString<'count'>
    /** 再起動 */
    readonly "restart": string
    /** 設定インポート */
    readonly "importSettingsTitle": string
    /** 現在の設定が上書きされます。アプリを再起動します。 */
    readonly "importSettingsMessage": string
    /** DB インポート */
    readonly "importDbTitle": string
    /** 現在の DB が上書きされます。アプリを再起動します。 */
    readonly "importDbMessage": string
  }
  readonly "_clipDetailContent": {
    /** クリップにノートがありません */
    readonly "empty": string
    /** リアクションに失敗しました ({code}) */
    readonly "reactionFailed": ParameterizedString<'code'>
    /** 投票に失敗しました ({code}) */
    readonly "voteFailed": ParameterizedString<'code'>
    /** お気に入り操作に失敗しました ({code}) */
    readonly "favoriteFailed": ParameterizedString<'code'>
  }
  readonly "_connectionsContent": {
    /** 接続したいサービスを選んでください */
    readonly "chooseService": string
    /** 接続を追加 */
    readonly "addConnection": string
    /** 手動で追加 */
    readonly "addManually": string
    /** 登録済みの接続 */
    readonly "registered": string
    /** AI から利用可能 */
    readonly "aiActive": string
    /** AI に開示中 (vault.use が無効か secret 未設定でまだ使えません) */
    readonly "aiPending": string
    /** プラグイン・ウィジェットから利用可能 */
    readonly "pluginActive": string
    /** プラグインに開示中 (vault.use が無効か secret 未設定でまだ使えません) */
    readonly "pluginPending": string
    /** 外部アプリから利用可能 */
    readonly "externalActive": string
    /** 外部アプリに開示中 (vault.use が無効か secret 未設定でまだ使えません) */
    readonly "externalPending": string
  }
  readonly "_driveFileDetailContent": {
    /** EXIF 情報 */
    readonly "exif": string
    /** 位置情報 (GPS) が含まれています */
    readonly "exifHasGps": string
    /** EXIF 情報は含まれていません */
    readonly "exifEmpty": string
  }
  readonly "_editHistoryContent": {
    /** {label}の編集履歴 */
    readonly "subtitle": ParameterizedString<'label'>
    /** 読み込み中... */
    readonly "loading": string
    /** 編集履歴はまだありません */
    readonly "empty": string
    /** 直前 */
    readonly "latest": string
    /** #{n} の状態に戻す */
    readonly "restore": ParameterizedString<'n'>
    /** 編集履歴 #{n} との差分 */
    readonly "compareWithEntry": ParameterizedString<'n'>
    /** 現在の内容との差分 */
    readonly "compareWithCurrent": string
  }
  readonly "_emojiMuteSection": {
    /** ミュート・凍結ユーザーのリアクションを隠す */
    readonly "hideMutedUserReactions": string
    /** リアクション集計から抹消する。リアクションが非常に多いノートは対象外 */
    readonly "hideMutedUserReactionsDescription": string
    /** ミュート中の絵文字 */
    readonly "mutedEmojis": string
    /** なし — リアクションや絵文字カラムの右クリックから追加できます */
    readonly "empty": string
    /** {emoji} — クリックで解除 */
    readonly "clickToUnmute": ParameterizedString<'emoji'>
  }
  readonly "_followListContent": {
    /** フォロー */
    readonly "following": string
    /** フォローしているユーザーはいません */
    readonly "noFollowing": string
    /** フォロワーはいません */
    readonly "noFollowers": string
    /** 取得に失敗しました ({code}) */
    readonly "fetchFailed": ParameterizedString<'code'>
    /** 読み込みに失敗しました ({code}) */
    readonly "loadFailed": ParameterizedString<'code'>
  }
  readonly "_instanceProfileContent": {
    /** 不明 */
    readonly "unknown": string
    /** 初観測 {date} */
    readonly "firstRetrieved": ParameterizedString<'date'>
    /** 更新 {time} */
    readonly "infoUpdated": ParameterizedString<'time'>
    /** 直近リクエスト受信 {time} */
    readonly "latestRequestReceived": ParameterizedString<'time'>
    /** 直近リクエスト送信 {time} */
    readonly "latestRequestSent": ParameterizedString<'time'>
    /** 新規登録オープン */
    readonly "registrationOpen": string
    /** 新規登録クローズ */
    readonly "registrationClosed": string
    /** 停止中 */
    readonly "suspended": string
    /** ブロック */
    readonly "blocked": string
    /** 無応答 */
    readonly "notResponding": string
    /** サイレンス */
    readonly "silenced": string
    /** メディアサイレンス */
    readonly "mediaSilenced": string
  }
  readonly "_keybindsContent": {
    /** 入力待ち... */
    readonly "recording": string
    /** ショートカットを追加 */
    readonly "addShortcut": string
    /** ユーザーカスタマイズの JSON (デフォルトからの差分のみ) */
    readonly "codeHint": string
    /** ダークモード切り替え */
    readonly "toggleDarkMode": string
    /** カラムを別ウィンドウ */
    readonly "popOutColumn": string
    /** 新規ウィンドウ */
    readonly "newWindow": string
    /** 全ウィンドウを閉じる */
    readonly "closeAllWindows": string
    /** PiP ウィンドウ */
    readonly "pipWindow": string
    /** プロファイル {n} */
    readonly "profileN": ParameterizedString<'n'>
    /** 全般 */
    readonly "categoryGeneral": string
    /** ナビゲーション */
    readonly "categoryNavigation": string
    /** カラム */
    readonly "categoryColumn": string
    /** ウィンドウ */
    readonly "categoryWindow": string
    /** JSON パースエラー */
    readonly "jsonParseError": string
  }
  readonly "_listDetailContent": {
    /** {count} メンバー */
    readonly "members_plural": PluralString<'count'>
    /** メンバーがいません */
    readonly "noMembers": string
    /** お気に入り操作に失敗しました ({code}) */
    readonly "favoriteFailed": ParameterizedString<'code'>
  }
  readonly "_memoEditorContent": {
    /** 読み込み中... */
    readonly "loading": string
    /** このメモは見つかりません */
    readonly "notFound": string
    /** メモを削除 */
    readonly "deleteTitle": string
    /** 選択したメモを削除しますか？ */
    readonly "deleteMessage": string
    /** メモを削除しました */
    readonly "deleted": string
  }
  readonly "_navEditorContent": {
    /** 現在のアイテム */
    readonly "currentItems": string
    /** アイテムを追加 */
    readonly "addItem": string
    /** 項目なし */
    readonly "noItems": string
    /** デフォルト値からの差分 — null はデフォルト設定を使用 */
    readonly "codeHint": string
    /** 配列または null が必要です */
    readonly "arrayOrNullRequired": string
    /** 無効な JSON5 */
    readonly "invalidJson5": string
  }
  readonly "_noteDetailContent": {
    /** 返信はありません */
    readonly "noReplies": string
    /** リノートはありません */
    readonly "noRenotes": string
    /** リアクションはありません */
    readonly "noReactions": string
    /** 返信 */
    readonly "replies": string
  }
  readonly "_noteInspectorContent": {
    /** ビュー */
    readonly "view": string
    /** {endpoint} 経由で解決した ActivityPub オブジェクト */
    readonly "activityPubObject": ParameterizedString<'endpoint'>
    /** URI を特定できませんでした */
    readonly "uriNotFound": string
  }
  readonly "_notificationInspectorContent": {
    /** メモリ上の通知オブジェクト */
    readonly "inMemoryObject": string
    /** {endpoint} 経由で解決した ActivityPub オブジェクト */
    readonly "activityPubObject": ParameterizedString<'endpoint'>
    /** この通知には ActivityPub URI がありません */
    readonly "noApUri": string
    /** この通知には紐づくノートがないため ActivityPub を解決できません */
    readonly "noNote": string
  }
  readonly "_pageEditContent": {
    /** タイトル */
    readonly "title": string
    /** 概要 */
    readonly "summary": string
  }
  readonly "_permissionProfileEditor": {
    /** 高リスク操作 */
    readonly "highRisk": string
  }
  readonly "_petSection": {
    /** ペット */
    readonly "title": string
    /** petdex.dev で見る */
    readonly "openPage": string
    /** ペットを外す */
    readonly "remove": string
    /** ペットの大きさ */
    readonly "size": string
    /** slug か petdex.dev のペット URL */
    readonly "inputPlaceholder": string
    /** 替える */
    readonly "replace": string
    /** 使う */
    readonly "use": string
    /** petdex.dev で探す */
    readonly "browse": string
  }
  readonly "_playDetailContent": {
    /** ソースを表示 */
    readonly "showSource": string
  }
  readonly "_playEditContent": {
    /** タイトル */
    readonly "title": string
    /** 概要 */
    readonly "summary": string
  }
  readonly "_pluginsContent": {
    /** 有効 */
    readonly "enabled": string
    /** AiScript プラグインコードを貼り付けてインストール */
    readonly "installHint": string
    /** プラグインの AiScript ソースコード — 編集後「保存して再起動」で反映 */
    readonly "codeHint": string
    /** ログはありません */
    readonly "noLogs": string
    /** ログ */
    readonly "logs": string
    /** コードを入力してください */
    readonly "codeRequired": string
    /** ヘッダーが不正です。先頭に /// @ 1.2.1 (AiScript >= 0.12) と ### { name: "...", version: "..." } が必要です */
    readonly "invalidHeader": string
    /** "{name}" は既にインストールされています */
    readonly "alreadyInstalled": ParameterizedString<'name'>
    /** 保存して再起動 */
    readonly "saveAndRestart": string
  }
  readonly "_postFormEditorContent": {
    /** 現在の並び */
    readonly "currentOrder": string
    /** ボタンなし */
    readonly "noButtons": string
    /** 追加できるボタン */
    readonly "availableButtons": string
    /** すべてのボタンが追加済み */
    readonly "allAdded": string
    /** デフォルト値からの差分 — null はデフォルト設定を使用 */
    readonly "codeHint": string
    /** 配列または null が必要です */
    readonly "arrayOrNullRequired": string
    /** 無効な JSON5 */
    readonly "invalidJson5": string
  }
  readonly "_profileEditorContent": {
    /** 「{name}」を編集中 */
    readonly "editingOther": ParameterizedString<'name'>
    /** プロファイル名 */
    readonly "profileName": string
    /** カラム */
    readonly "columns": string
    /** カラムがありません */
    readonly "noColumns": string
    /** 有効な JSON オブジェクトではありません */
    readonly "notJsonObject": string
  }
  readonly "_snippetsEditorContent": {
    /** VSCode 互換のスニペット — prefix で補完に出ます */
    readonly "codeHint": string
    /** 元に戻しますか？ */
    readonly "confirmReset": string
    /** 編集中... */
    readonly "editing": string
    /** {file} の読み込みに失敗しました: {error} */
    readonly "loadFailed": ParameterizedString<'error' | 'file'>
    /** 保存に失敗しました */
    readonly "saveFailed": string
  }
  readonly "_tutorialEditorContent": {
    /** 操作するとチェックが付きます。カテゴリを終えると実績になり、通知に届きます。 */
    readonly "lead": string
    /** ドキュメントを読む */
    readonly "readDocs": string
    /** このステップの解説を読む */
    readonly "readStepDocs": string
    /** 読む */
    readonly "read": string
    /** 案内を表示 */
    readonly "showGuide": string
    /** このカテゴリで案内する機能を表示する */
    readonly "unlockDescription": string
    /** 開発者モードで開放 */
    readonly "unlock": string
    /** もう一度 */
    readonly "again": string
    /** はじめる */
    readonly "start": string
    /** 続きから */
    readonly "resume": string
    /** もう一度押すと消えます */
    readonly "confirmReset": string
    /** 達成記録を消す */
    readonly "reset": string
  }
  readonly "_userActivityFollowingChart": {
    /** フォローデータを取得できません */
    readonly "unavailable": string
  }
  readonly "_userActivityHeatmap": {
    /** アクティビティを表示できません */
    readonly "unavailable": string
    /** アクティビティ */
    readonly "activity": string
  }
  readonly "_userActivityNotesChart": {
    /** 投稿データを取得できません */
    readonly "unavailable": string
  }
  readonly "_userActivityPvChart": {
    /** PV データを取得できません */
    readonly "unavailable": string
  }
  readonly "_userProfileContent": {
    /** リモートユーザーのため、情報が不完全です。 */
    readonly "remoteCaution": string
    /** リモートで表示 */
    readonly "showOnRemote": string
    /** ピン留め */
    readonly "pinned": string
    /** ファイルはありません */
    readonly "noFiles": string
    /** リアクションはありません */
    readonly "noReactions": string
    /** ファイル */
    readonly "tabFiles": string
    /** アクティビティ */
    readonly "tabActivity": string
    /** ページ */
    readonly "tabPages": string
    /** ギャラリー */
    readonly "tabGallery": string
    /** リスト */
    readonly "tabLists": string
    /** クリップ */
    readonly "tabClips": string
    /** 実績 */
    readonly "tabAchievements": string
    /** プロフィールを編集 */
    readonly "editProfile": string
  }
  readonly "_widgetEditContent": {
    /** 自動実行: 有効 (クリックで切り替え) */
    readonly "autoRunOnTitle": string
    /** 自動実行: 無効 (クリックで切り替え) */
    readonly "autoRunOffTitle": string
    /** 自動実行 ON */
    readonly "autoRunOn": string
    /** 自動実行 OFF */
    readonly "autoRunOff": string
    /** ウィジェットが見つかりません */
    readonly "notFound": string
    /** 右上の実行ボタンでウィジェットを実行 */
    readonly "runHint": string
    /** 出力 ({n}) */
    readonly "output": ParameterizedString<'n'>
    /** 未保存の変更 */
    readonly "unsaved": string
  }
  readonly "_aboutContent": {
    /** 公式サイトを開く */
    readonly "openOfficialSite": string
    /** アップデートを確認 */
    readonly "checkForUpdate": string
    /** 最新 */
    readonly "upToDate": string
    /** アップデート */
    readonly "update": string
    /** 更新の準備ができました */
    readonly "updateReady": string
    /** v{version} をダウンロード中 */
    readonly "downloading": ParameterizedString<'version'>
    /** 再起動 */
    readonly "restart": string
    /** 開発者モード */
    readonly "developerMode": string
    /** 開発者 */
    readonly "developer": string
    /** バージョン情報 */
    readonly "versionInfo": string
    /** 情報をコピー */
    readonly "copyInfo": string
    /** バグを報告 */
    readonly "reportBug": string
    /** 自己診断 */
    readonly "selfDiagnosis": string
    /** 問題は見つかりませんでした */
    readonly "noProblems": string
    /** 再診断 */
    readonly "rediagnose": string
    /** 起動パフォーマンス */
    readonly "startupPerformance": string
    /** フェーズ */
    readonly "phase": string
    /** 区間 */
    readonly "segment": string
    /** 累計 */
    readonly "cumulative": string
    /** WebView 起動はプロセス初回のナビゲーションでのみ計測されます (累計は画面読み込み起点) */
    readonly "webviewStartupNote": string
    /** 実行時パフォーマンス */
    readonly "runtimePerformance": string
    /** 計測中... */
    readonly "measuring": string
    /** パフォーマンス設定を開く */
    readonly "openPerformanceSettings": string
    /** ストリーム切断 ({duration}) */
    readonly "streamDisconnected": ParameterizedString<'duration'>
    /** ストリーム再接続中 ({duration}) */
    readonly "streamReconnecting": ParameterizedString<'duration'>
    /** ネットワークとサーバーの状態を確認 */
    readonly "streamFix": string
    /** 時刻不明 */
    readonly "unknownTime": string
    /** {when} に異常終了しました: {headline} */
    readonly "crashed": ParameterizedString<'headline' | 'when'>
    /** 下の診断ログをコピーして報告 */
    readonly "crashFix": string
    /** 診断中... */
    readonly "diagnosing": string
    /** 診断に失敗しました */
    readonly "diagnosisFailed": string
    /** {count} 件の問題 */
    readonly "problems_plural": PluralString<'count'>
    /** {count} 件の警告 */
    readonly "warnings_plural": PluralString<'count'>
    /** 正常 */
    readonly "statusOk": string
    /** WebView 起動 */
    readonly "startupWebview": string
    /** スクリプト読み込み */
    readonly "startupMainEval": string
    /** 初期化処理 */
    readonly "startupSettingsAwait": string
    /** 設定読み込み */
    readonly "startupSettingsLoaded": string
    /** Vue マウント */
    readonly "startupMounted": string
    /** ウィンドウ表示 */
    readonly "startupWindowShown": string
    /** デッキ表示 */
    readonly "startupDeckMounted": string
    /** カラム setup */
    readonly "startupColumnSetup": string
    /** カラム接続開始 */
    readonly "startupColumnConnect": string
    /** DB キャッシュ到着 */
    readonly "startupCacheLoaded": string
    /** 初回ノート表示 */
    readonly "startupFirstNotes": string
    /** 低 */
    readonly "qualityLow": string
    /** バランス */
    readonly "qualityBalanced": string
    /** 高 */
    readonly "qualityHigh": string
    /** 接続なし */
    readonly "streamUnknown": string
    /** 接続中 */
    readonly "streamInitializing": string
    /** 正常 */
    readonly "streamHealthy": string
    /** 一部切断 */
    readonly "streamDegraded": string
    /** 切断 */
    readonly "streamOffline": string
    /** オフラインモード */
    readonly "streamManualOffline": string
    /** フレーム時間 */
    readonly "frameTime": string
    /** {time} (予算 {budget}) */
    readonly "frameTimeValue": ParameterizedString<'budget' | 'time'>
    /** p95 フレーム時間 */
    readonly "p95FrameTime": string
    /** {time} ({count} サンプル) */
    readonly "p95FrameTimeValue_plural": PluralString<'count' | 'time'>
    /** フレーム落ち */
    readonly "frameDrops": string
    /** {count} 回/秒 */
    readonly "frameDropsValue": ParameterizedString<'count'>
    /** フレーム計測 */
    readonly "frameMeasurement": string
    /** アイドル (描画作業なし) */
    readonly "frameIdle": string
    /** JS ヒープ */
    readonly "jsHeap": string
    /** 画像メモリ (推定) */
    readonly "imageMemory": string
    /** {size} ({urls} URL / {elements} 要素) */
    readonly "imageMemoryValue": ParameterizedString<'elements' | 'size' | 'urls'>
    /** 描画品質 */
    readonly "renderQuality": string
    /** {level} (自動調整あり) */
    readonly "renderQualityAuto": ParameterizedString<'level'>
    /** {level} (自動調整なし) */
    readonly "renderQualityManual": ParameterizedString<'level'>
    /** ストリーム接続 */
    readonly "streamConnection": string
    /** {health} ({count} 接続) */
    readonly "streamConnectionValue_plural": PluralString<'count' | 'health'>
    /** アイドル中です。デッキを操作すると計測が始まります */
    readonly "adviceIdle": string
    /** 描画が追いついていません。自動調整が品質を下げて追従します。改善しない場合はパフォーマンス設定を省電力寄りにしてください */
    readonly "adviceFailAuto": string
    /** 描画が追いついていません。パフォーマンス設定で品質を下げるとカクつきが減ります */
    readonly "adviceFail": string
    /** 描画にやや負荷がかかっています。カクつきを感じる場合はパフォーマンス設定で品質を下げてください */
    readonly "adviceWarn": string
    /** 描画に余裕があります。安定が続けば自動調整が品質を上げます */
    readonly "adviceRoomAuto": string
    /** 描画に余裕があります。パフォーマンス設定で品質を上げても快適に動く見込みです */
    readonly "adviceRoom": string
    /** 描画は良好です */
    readonly "adviceGood": string
    /** N/A (リロード後) */
    readonly "notAvailableAfterReload": string
    /** 合計: {time} */
    readonly "startupTotal": ParameterizedString<'time'>
    /** 起動 */
    readonly "infoStartup": string
    /** 診断 */
    readonly "infoDiagnostics": string
    /** 現象 */
    readonly "issueWhat": string
    /** 何が起きたか */
    readonly "issueWhatHint": string
    /** 再現手順 */
    readonly "issueSteps": string
    /** 期待する動作 */
    readonly "issueExpected": string
    /** 本来どうなるべきか */
    readonly "issueExpectedHint": string
    /** 環境 */
    readonly "issueEnvironment": string
    /** スクリーンショット */
    readonly "issueScreenshot": string
    /** あれば添付 */
    readonly "issueScreenshotHint": string
    /** 異常終了の backtrace は「{copyInfo}」で取得して貼り付けてください */
    readonly "issuePanicNote": ParameterizedString<'copyInfo'>
  }
  readonly "_cacheEditorContent": {
    /** 使用状況 */
    readonly "usage": string
    /** DB サイズ */
    readonly "dbSize": string
    /** 画像キャッシュ */
    readonly "imageCache": string
    /** 上限 */
    readonly "maxSize": string
    /** 保持期間 */
    readonly "retention": string
    /** 日 */
    readonly "days": string
    /** 処理中... */
    readonly "processing": string
    /** 画像キャッシュ削除 */
    readonly "clearImages": string
    /** 画像キャッシュ削除 ({count} 件) */
    readonly "clearImagesWithCount_plural": PluralString<'count'>
    /** 保存粒度 */
    readonly "granularity": string
    /** このキャッシュはクライアント検索の索引でもあります。フォロワー限定やダイレクトを含む、自分の目を通った全ノートが暗号化されずに保存されます。 */
    readonly "searchIndexNote": string
    /** アカウントあたり上限 */
    readonly "perAccountLimit": string
    /** 手動削除 */
    readonly "manualClear": string
    /** ノートと OGP のキャッシュをすべて削除します。サーバーから再取得すれば復元されます。 */
    readonly "manualClearNote": string
    /** ノートキャッシュと OGP キャッシュをすべて削除しますか？ */
    readonly "clearCacheConfirm": string
    /** ディスク上の画像キャッシュをすべて削除しますか？表示のたびにサーバーから再取得されます。 */
    readonly "clearImagesConfirm": string
    /** {count} 件 */
    readonly "noteCount_plural": PluralString<'count'>
    /** 無制限 */
    readonly "unlimited": string
    /** {count} 日 */
    readonly "dayCount_plural": PluralString<'count'>
    /** 無期限 */
    readonly "noExpiry": string
  }
  readonly "_columnQueryEditorContent": {
    /** クエリ名 */
    readonly "queryName": string
    /** 説明 (任意) */
    readonly "descriptionOptional": string
    /** AiScript 式でカラムに流すノートを定義します (true = 表示)。例: {example}。カラムへの適用はタイムラインカラムのフィルターメニューで切り替えます。 */
    readonly "hint": ParameterizedString<'example'>
    /** note.text != null && note.text.incl("キーワード") */
    readonly "sourcePlaceholder": string
    /** 高速クエリ (QIR {count} ノード) */
    readonly "fastQuery_plural": PluralString<'count'>
    /** 直近の TL カラム {total} 件中 {match} 件通過 */
    readonly "dryRun": ParameterizedString<'match' | 'total'>
    /** ・エラー {count} 件 (除外) */
    readonly "dryRunErrors_plural": PluralString<'count'>
    /** {line}行: */
    readonly "lineLabel": ParameterizedString<'line'>
    /** 末尾の式を {guard} で守ります */
    readonly "guardTitle": ParameterizedString<'guard'>
    /** ガードを入れる */
    readonly "addGuard": string
    /** 逐次適用 (1 件ずつ判定するため検索では使えません) */
    readonly "sequential": string
    /** このまま保存 */
    readonly "saveAnyway": string
    /** クエリを保存しました */
    readonly "saved": string
  }
  readonly "_connectionEditContent": {
    /** 名前 */
    readonly "name": string
    /** 認証方式 */
    readonly "authMethod": string
    /** 任意ヘッダー */
    readonly "customHeader": string
    /** ヘッダー名 (例: x-api-key) */
    readonly "headerNamePlaceholder": string
    /** クエリパラメーター */
    readonly "queryParam": string
    /** パラメーター名 (例: api_key) */
    readonly "paramNamePlaceholder": string
    /** ベーシック認証 */
    readonly "basicAuth": string
    /** ユーザー名 */
    readonly "username": string
    /** シークレット */
    readonly "secret": string
    /** 設定済み */
    readonly "secretSet": string
    /** 鍵を入れ替える */
    readonly "rotateSecret": string
    /** 16 文字以上 */
    readonly "secretPlaceholder": string
    /** 発行手順を開く */
    readonly "openIssueGuide": string
    /** 詳細 */
    readonly "advanced": string
    /** 許可するホスト (カンマ区切り) */
    readonly "allowedHosts": string
    /** 自動: baseUrl のホスト */
    readonly "allowedHostsPlaceholder": string
    /** メモ */
    readonly "notes": string
    /** ここにシークレットを書かないでください */
    readonly "notesPlaceholder": string
    /** AI に見せる */
    readonly "exposeAi": string
    /** OFF だと AI (チャット / HEARTBEAT) には接続の存在自体が見えません */
    readonly "exposeAiHint": string
    /** AI の vault.use が無効のため、この接続はまだ見えません — 権限ウィンドウを開いて許可してください */
    readonly "aiVaultUseDisabled": string
    /** 確認なしで使う (AI) */
    readonly "trustAi": string
    /** AI がこの接続を使うとき確認ダイアログを出しません */
    readonly "trustAiHint": string
    /** プラグイン・ウィジェットに見せる */
    readonly "exposePlugin": string
    /** AiScript プラグイン / ウィジェットからこの接続を使えるようにします */
    readonly "exposePluginHint": string
    /** プラグインの vault.use が無効のため、この接続はまだ見えません — 権限ウィンドウを開いて許可してください */
    readonly "pluginVaultUseDisabled": string
    /** 確認なしで使えるプラグイン・ウィジェット (確認ダイアログの「今後確認なし」で追加されます) */
    readonly "trustedPlugins": string
    /** 信頼を取り消す (次回から確認ダイアログが出ます) */
    readonly "revokeTrust": string
    /** 外部アプリに見せる */
    readonly "exposeExternal": string
    /** HTTP API (永続トークン) 経由の外部アプリから使えるようにします */
    readonly "exposeExternalHint": string
    /** 外部アプリの vault.use が無効のため、この接続はまだ見えません — 権限設定を開いて許可してください */
    readonly "externalVaultUseDisabled": string
    /** 確認なしで使う (外部アプリ) */
    readonly "trustExternal": string
    /** 外部アプリがこの接続を使うとき確認ダイアログを出しません */
    readonly "trustExternalHint": string
    /** テスト中... */
    readonly "testing": string
    /** テスト */
    readonly "test": string
    /** 名前を入力してください */
    readonly "nameRequired": string
    /** URL を入力してください */
    readonly "urlRequired": string
    /** ヘッダー名を入力してください */
    readonly "headerNameRequired": string
    /** クエリパラメーター名を入力してください */
    readonly "queryParamRequired": string
    /** secret は 16 文字以上にしてください */
    readonly "secretTooShort": string
    /** secret を入力してください */
    readonly "secretRequired": string
    /** 先に接続を保存してからテストしてください */
    readonly "saveBeforeTest": string
    /** 接続を削除 */
    readonly "deleteTitle": string
    /** 「{name}」を削除しますか？ secret も OS キーチェーンから完全に削除されます。 */
    readonly "deleteMessage": ParameterizedString<'name'>
    /** ✓ 接続成功 (HTTP {status}) */
    readonly "testSuccess": ParameterizedString<'status'>
    /** 失敗 */
    readonly "testFailed": string
  }
  readonly "_cssEditorContent": {
    /** カスタム CSS */
    readonly "customCss": string
    /** プリセット */
    readonly "presets": string
    /** フォント */
    readonly "font": string
    /** あいうえお 漢字 ABCabc 123 Il1 O0 */
    readonly "fontPreview": string
    /** 等幅フォント */
    readonly "monoFont": string
    /** const 変数 = 0; // Il1 O0 */
    readonly "monoFontPreview": string
    /** コードブロック・JSON ビューアー・エディター系に反映されます */
    readonly "monoFontNote": string
    /** フォントサイズ */
    readonly "fontSize": string
    /** 小 */
    readonly "small": string
    /** 大 */
    readonly "large": string
    /** リセット */
    readonly "reset": string
    /** 公開範囲の色分け */
    readonly "visibilityBg": string
    /** ノートの数字を隠す */
    readonly "hideNoteCounts": string
    /** リアクション数とリノート数が消えます (返信数は会話の量なので残ります) */
    readonly "hideNoteCountsNote": string
    /** プロフィールの数字を隠す */
    readonly "hideUserStats": string
    /** ノート数・フォロー数・フォロワー数が「-」になります (クリック導線は残ります) */
    readonly "hideUserStatsNote": string
    /** 追加 CSS */
    readonly "freeformCss": string
    /** CSS にエラーがあるため適用されません */
    readonly "cssErrorHint": string
    /** プリセットと追加 CSS を結合した全体の CSS です */
    readonly "codeHint": string
    /** プリセットに同期 */
    readonly "syncToPresets": string
    /** クリアしますか？ */
    readonly "confirmClear": string
    /** すべてクリア */
    readonly "clearAll": string
    /** デフォルト (15px) */
    readonly "defaultFontSize": string
    /** CSS パースエラー */
    readonly "cssParseError": string
  }
  readonly "_loginContent": {
    /** 確認中... */
    readonly "checking": string
    /** サーバーに接続できます */
    readonly "serverReachable": string
    /** Misskey サーバーに接続 */
    readonly "connectToServer": string
    /** サーバーアドレス */
    readonly "serverAddress": string
    /** ホスト名を入力してください */
    readonly "enterHost": string
    /** ログイン */
    readonly "login": string
    /** ゲストとして閲覧 */
    readonly "browseAsGuest": string
    /** サーバーに接続中... */
    readonly "connecting": string
    /** 認証待ち... */
    readonly "waitingForAuth": string
    /** ブラウザーで認証画面が開きました。 */
    readonly "authOpened": string
    /** 認証が完了したら、下のボタンをクリックしてください。 */
    readonly "authInstruction": string
    /** 認証しました */
    readonly "authDone": string
    /** やり直す */
    readonly "startOver": string
  }
  readonly "_performanceEditorContent": {
    /** 電源・回線・ウィンドウの状態に合わせて自動調整する */
    readonly "autoAdapt": string
    /** バッテリー駆動・省電力モードでは画像の先読みとアニメーション絵文字を止め、従量制回線では画像・動画をタップで読み込み、ウィンドウを隠している間はタイムラインの購読を休止する */
    readonly "autoAdaptDescription": string
    /** 省メモリ */
    readonly "lowMemory": string
    /** 高性能 */
    readonly "highPerformance": string
    /** 全体のバランスを保ったまま上下させる */
    readonly "masterTitle": string
    /** デフォルト: {value} */
    readonly "defaultValue": ParameterizedString<'value'>
    /** デフォルト値からの差分のみが JSON 形式で保存されます */
    readonly "codeHint": string
    /** 不明なキー: {key} */
    readonly "unknownKey": ParameterizedString<'key'>
    /** JSON 解析エラー */
    readonly "jsonParseError": string
  }
  readonly "_permissionsContent": {
    /** 開示された接続がまだありません — */
    readonly "noExposedConnections": string
    /** 接続一覧を開く */
    readonly "openConnections": string
    /** 確認なしで実行できる操作 */
    readonly "confirmSkipTitle": string
    /** 確認ダイアログで「今後この操作を確認しない」を選んだ操作。取り消すと次回から再び確認されます。 */
    readonly "confirmSkipHint": string
    /** 取り消す */
    readonly "revoke": string
    /** 永続 API トークン */
    readonly "apiTokens": string
    /** 再起動を跨いで使える名前付きトークン。本体はハッシュのみ保存され、発行時に一度だけ表示されます。 */
    readonly "apiTokensHint": string
    /** 失効 */
    readonly "revokeToken": string
    /** トークン名 (例: Raycast, Claude Cowork) */
    readonly "tokenNamePlaceholder": string
    /** 発行 */
    readonly "issueToken": string
    /** 「{name}」のトークン — この表示を閉じると再表示できません */
    readonly "createdTokenNotice": ParameterizedString<'name'>
    /** permissions.json5 を直接編集できます。principal (ai.chat / ai.heartbeat / plugin / external) ごとの preset と custom マップを持ちます。 */
    readonly "codeHint": string
    /** AI への指示チャネルは第三者には開放できません */
    readonly "instructionRuleReason": string
    /** タスクは本人と AI のみが実行できます */
    readonly "tasksRuleReason": string
    /** 共有プロファイルでは Misskey の read は常に許可 — 遮断するにはトークンを失効 */
    readonly "externalFloorReason": string
    /** AI チャット */
    readonly "aiChat": string
    /** AI の tool calling (チャット / コマンド / タスク) に許可する操作 */
    readonly "aiChatHint": string
    /** 無人で定期実行される AI daemon に許可する操作 (チャットとは独立) */
    readonly "heartbeatHint": string
    /** AiScript プラグイン / ウィジェット / Play に許可する操作 */
    readonly "pluginHint": string
    /** 外部アプリ */
    readonly "external": string
    /** HTTP API (永続トークン) 経由の外部アプリに許可する操作 */
    readonly "externalHint": string
    /** スクラッチパッドカラムで自分が書いて実行するコードに許可する操作 (デフォルトは読み取りのみ) */
    readonly "scratchpadHint": string
  }
  readonly "_skillEditContent": {
    /** スキルが見つかりません */
    readonly "notFound": string
    /** メタ */
    readonly "meta": string
    /** 指示文 */
    readonly "instructions": string
    /** 名前 */
    readonly "name": string
    /** スキル名 */
    readonly "namePlaceholder": string
    /** 説明 */
    readonly "description": string
    /** どんな時に使うか */
    readonly "descriptionPlaceholder": string
    /** 作者 */
    readonly "author": string
    /** 任意 */
    readonly "optional": string
    /** バージョン */
    readonly "version": string
    /** モード */
    readonly "mode": string
    /** 常時 */
    readonly "modeAlways": string
    /** 手動 */
    readonly "modeManual": string
    /** 自動 */
    readonly "modeTrigger": string
    /** HEARTBEAT (定期実行) */
    readonly "modeHeartbeat": string
    /** HEARTBEAT 有効時、tick ごとにこの skill body を AI に読ませます (#411 / OpenClaw HEARTBEAT.md 相当)。 */
    readonly "heartbeatHint": string
    /** 自動起動: ユーザーの入力に下のトリガー語のいずれかが含まれたターンだけ、この skill body が system prompt に注入されます (大文字小文字無視の部分一致)。 */
    readonly "triggerHint": string
    /** トリガー語 (1 行に 1 つ) */
    readonly "triggers": string
    /** どこ
使い方
help */
    readonly "triggersPlaceholder": string
    /** トリガー語はモードを「自動」にしたときだけ反応します */
    readonly "triggersOnlyInTriggerMode": string
    /** このスキルを AI セッションの persona 候補にする */
    readonly "personaToggle": string
    /** ON にすると、AI セッションヘッダーの persona セレクターにこのスキルが表示されます。選択中のセッションで AI はこの persona として振る舞い、memo の作者として記録されます (#491)。 */
    readonly "personaHint": string
    /** ストア由来のスキル — 編集内容はローカルファイルに保存されます (再インストールで上書きされる可能性あり) */
    readonly "fromStoreNote": string
    /** 未保存の変更 */
    readonly "unsavedChanges": string
  }
  readonly "_tasksEditorContent": {
    /** 宣言したタスクはコマンドパレットと Task Runner カラムから実行できます。 */
    readonly "visualHint": string
    /** ドラッグで並び替え */
    readonly "dragToReorder": string
    /** デフォルト実行対象 */
    readonly "defaultTask": string
    /** (無題) */
    readonly "untitled": string
    /** 入力を求める */
    readonly "promptsForInput": string
    /** ラベル */
    readonly "label": string
    /** UI 表示名 */
    readonly "labelPlaceholder": string
    /** 説明 */
    readonly "description": string
    /** 任意 (ツールチップ用の長文) */
    readonly "descriptionPlaceholder": string
    /** ラベル下の 1 行補足 (任意) */
    readonly "detailPlaceholder": string
    /** 自由文字列 (任意) */
    readonly "groupPlaceholder": string
    /** デフォルト実行対象 (1 件のみ) */
    readonly "defaultTaskOnlyOne": string
    /** 現在アクティブ */
    readonly "accountActive": string
    /** 最初のログイン済み */
    readonly "accountFirst": string
    /** 指定 ID */
    readonly "accountSpecific": string
    /** アクション (api) */
    readonly "action": string
    /** 表示オプション (presentation) */
    readonly "presentation": string
    /** 実行時に履歴で自動選択する (revealOnRun) */
    readonly "revealOnRun": string
    /** 実行時に過去履歴をクリア (clearHistoryOnRun) */
    readonly "clearHistoryOnRun": string
    /** 入力フィールド */
    readonly "inputFields": string
    /** プロンプト */
    readonly "prompt": string
    /** 選択肢 (1 行に 1 つ) */
    readonly "pickOptionsPlaceholder": string
    /** デフォルト (任意) */
    readonly "defaultPlaceholder": string
    /** 入力なし — タスクは即座に実行されます */
    readonly "noInputs": string
    /** タスクがまだありません */
    readonly "empty": string
    /** タスクを追加 */
    readonly "addTask": string
    /** 変数: */
    readonly "variables": string
    /** {count} タスクを解析済み */
    readonly "parsedTasks_plural": PluralString<'count'>
    /**  · 保存中... */
    readonly "savingSuffix": string
    /** サンプルに戻す */
    readonly "resetToSample": string
    /** tasks.json5 の読み込みに失敗しました: {error} */
    readonly "loadFailed": ParameterizedString<'error'>
    /** 保存に失敗しました: {error} */
    readonly "saveFailed": ParameterizedString<'error'>
    /** オブジェクト ({}) が必要です */
    readonly "objectRequired": string
    /** リセットに失敗しました: {error} */
    readonly "resetFailed": ParameterizedString<'error'>
    /** 新しいタスク */
    readonly "newTaskLabel": string
    /** 入力してください */
    readonly "newInputPrompt": string
  }
  readonly "_themeEditorContent": {
    /** ライト */
    readonly "light": string
    /** ダーク */
    readonly "dark": string
    /** テーマ情報 */
    readonly "themeInfo": string
    /** テーマ名 */
    readonly "themeName": string
    /** 既存テーマ */
    readonly "existingThemes": string
    /** テーマを選択... */
    readonly "selectTheme": string
    /** 基本色 */
    readonly "primaryColors": string
    /** 追加プロパティ */
    readonly "extraProperties": string
    /** プロパティを追加 ({n}) */
    readonly "addProperty": ParameterizedString<'n'>
    /** 検索... */
    readonly "search": string
    /** 一致するプロパティがありません */
    readonly "noMatchingProperties": string
    /** コードから反映 */
    readonly "applyFromCode": string
    /** アクセント */
    readonly "propAccent": string
    /** 背景 */
    readonly "propBg": string
    /** 文字色 */
    readonly "propFg": string
    /** パネル */
    readonly "propPanel": string
    /** ナビバー背景 */
    readonly "propNavBg": string
    /** いいね */
    readonly "propLove": string
    /** リンク */
    readonly "propLink": string
    /** 区切り線 */
    readonly "propDivider": string
    /** 成功 */
    readonly "propSuccess": string
    /** エラー */
    readonly "propError": string
    /** 警告 */
    readonly "propWarn": string
    /** テーマオブジェクトに props がありません */
    readonly "noProps": string
    /** JSON パースエラー */
    readonly "jsonParseError": string
    /** 上書き保存 */
    readonly "overwriteSave": string
    /** テーマを削除 */
    readonly "deleteTitle": string
    /** 「{name}」を削除しますか？テーマの設定も消えます。 */
    readonly "deleteMessage": ParameterizedString<'name'>
    /** テーマを削除しました */
    readonly "deleted": string
  }
  readonly "_deckAiColumn": {
    /** Persona: {name} (エージェント設定で変更) */
    readonly "personaIndicator": ParameterizedString<'name'>
    /** セッション一覧へ戻る */
    readonly "backToSessions": string
    /** セッションを検索... */
    readonly "searchSessions": string
    /** セッションはまだありません */
    readonly "noSessions": string
    /** 一致するセッションがありません */
    readonly "noMatchingSessions": string
    /** 無題のチャット */
    readonly "untitledChat": string
    /** 質問するか /help でコマンド一覧 */
    readonly "inputPlaceholder": string
    /** /help でコマンド一覧 (API キー未設定) */
    readonly "inputPlaceholderNoApiKey": string
    /** AI に質問するには API キーの設定が必要です (/help などのコマンドはそのまま使えます) */
    readonly "apiKeyRequired": string
    /** AI 設定を案内 */
    readonly "aiSetupGuide": string
    /** 詳細を閉じる */
    readonly "hideDetails": string
    /** 詳細を開く */
    readonly "showDetails": string
    /** ツール呼び出し */
    readonly "toolCall": string
    /** 結果 */
    readonly "toolResult": string
    /** 提案 */
    readonly "intent": string
    /** 無人実行 (HEARTBEAT) が提案した操作です。実行前に確認が出ます。 */
    readonly "intentNote": string
    /** 他人の内容を読んだ文脈で作られました。宛先と本文を確かめてください。 */
    readonly "intentUntrusted": string
    /** 下書きにできませんでした: {error} */
    readonly "intentDraftFailed": ParameterizedString<'error'>
    /** 却下 */
    readonly "dismiss": string
    /** 停止 */
    readonly "stop": string
    /** 今日 */
    readonly "today": string
    /** 昨日 */
    readonly "yesterday": string
    /** 過去 7 日 */
    readonly "last7Days": string
    /** それ以前 */
    readonly "older": string
    /** セッション名を変更 */
    readonly "renameTitle": string
    /** セッション名 */
    readonly "renamePlaceholder": string
    /** セッション名を変更しました */
    readonly "renamed": string
    /** セッションを削除 */
    readonly "deleteSessionTitle": string
    /** 「{title}」を削除しますか？この操作は取り消せません。 */
    readonly "deleteSessionConfirm": ParameterizedString<'title'>
    /** セッションを削除しました */
    readonly "sessionDeleted": string
    /** 下書きに保存済み */
    readonly "intentDrafted": string
    /** 実行済み */
    readonly "intentExecuted": string
    /** 却下 */
    readonly "intentDismissed": string
    /** 未処理 */
    readonly "intentPending": string
    /** 無人実行 (HEARTBEAT) が他人の内容を読んで作った操作です。宛先と本文を確かめてから許可してください。 */
    readonly "intentConfirmNoteUntrusted": string
    /** 無人実行 (HEARTBEAT) が提案した操作です。 */
    readonly "intentConfirmNote": string
    /** 実行できませんでした: {error} */
    readonly "intentRunFailed": ParameterizedString<'error'>
    /** AI の API キーが設定されていないため、この質問には応答できません。

AI プロバイダーの API キーを登録すると使えるようになります。下の「{button}」からチュートリアルを開けます。

`/help` などの / コマンドは API キーなしで実行できます。 */
    readonly "setupRequiredMessage": ParameterizedString<'button'>
    /** {command} の実行 */
    readonly "slashRunTitle": ParameterizedString<'command'>
  }
  readonly "_deckClientSearchColumn": {
    /** 手元のノートを検索... */
    readonly "searchPlaceholder": string
    /** 絞り込み */
    readonly "filter": string
    /** 古い順 */
    readonly "oldestFirst": string
    /** 新しい順 */
    readonly "newestFirst": string
    /** 範囲 */
    readonly "scope": string
    /** すべてのアカウント */
    readonly "allAccounts": string
    /** {host} (サーバー) */
    readonly "serverOption": ParameterizedString<'host'>
    /** 投稿者 */
    readonly "author": string
    /** name または name@host */
    readonly "authorPlaceholder": string
    /** 期間 */
    readonly "period": string
    /** 開始日 */
    readonly "since": string
    /** 終了日 */
    readonly "until": string
    /** 添付 */
    readonly "attachments": string
    /** 問わない */
    readonly "attachmentsAny": string
    /** あり */
    readonly "attachmentsYes": string
    /** なし */
    readonly "attachmentsNo": string
    /** 絞り込みをクリア */
    readonly "clearFilters": string
    /** 手元のキャッシュに一致するノートはありません */
    readonly "noMatches": string
    /** 検索語か絞り込みを入れると、手元に貯めたノートから引きます */
    readonly "emptyHint": string
  }
  readonly "_deckColumn": {
    /** ログアウト中 */
    readonly "loggedOut": string
    /** 最前面固定を解除 */
    readonly "unpinOnTop": string
    /** 最前面に固定 */
    readonly "pinOnTop": string
    /** デッキに戻す */
    readonly "returnToDeck": string
    /** Web UI で開く */
    readonly "openWebUi": string
    /** 分割を解除 */
    readonly "unstack": string
    /** 別ウィンドウで開く */
    readonly "popOut": string
    /** PiP ウィンドウとして開く */
    readonly "openAsPip": string
    /** メインウィンドウに戻す */
    readonly "recallToMain": string
    /** カラムを削除 */
    readonly "deleteTitle": string
    /** このカラムを削除しますか？ */
    readonly "deleteConfirm": string
    /** カラムを削除しました */
    readonly "deleted": string
  }
  readonly "_deckDriveColumn": {
    /** ルート */
    readonly "root": string
    /** 選択 */
    readonly "select": string
    /** アップロード */
    readonly "upload": string
    /** このフォルダの選択を解除 */
    readonly "deselectFolder": string
    /** このフォルダを全選択 */
    readonly "selectFolder": string
    /** {count} 件 */
    readonly "selectedCount_plural": PluralString<'count'>
    /** (他 {n}) */
    readonly "selectedOutside": ParameterizedString<'n'>
    /** すべて解除 */
    readonly "deselectAll": string
    /** 移動 */
    readonly "move": string
    /** 選択したファイルを移動 */
    readonly "moveSelected": string
    /** 保存中 {done}/{total} */
    readonly "exporting": ParameterizedString<'done' | 'total'>
    /** 選択したファイルをローカルに保存 */
    readonly "exportSelected": string
    /** 選択したファイルを削除 */
    readonly "deleteSelected": string
    /** ファイルを一括削除 */
    readonly "bulkDeleteTitle": string
    /** 選択中の {count} 件のファイルをドライブから削除しますか？添付したノートからも消えます。この操作は取り消せません。 */
    readonly "bulkDeleteConfirm_plural": PluralString<'count'>
    /** 選択中の {count} 件のファイルをドライブから削除しますか？ (現在のフォルダ外で選択した {outside} 件を含む) 添付したノートからも消えます。この操作は取り消せません。 */
    readonly "bulkDeleteConfirmWithOutside_plural": PluralString<'count' | 'outside'>
    /** {count} 件は情報を取得できず保存対象から外れました */
    readonly "exportMissing_plural": PluralString<'count'>
    /** 保存を中断しました */
    readonly "exportCancelled": string
    /** {count} 件の保存に失敗しました */
    readonly "exportFailed_plural": PluralString<'count'>
    /** {count} 件を保存しました */
    readonly "exported_plural": PluralString<'count'>
    /** {count} 件を保存しました ({skipped} 件は保存済み) */
    readonly "exportedWithSkipped_plural": PluralString<'count' | 'skipped'>
    /** フォルダを開く */
    readonly "openFolder": string
  }
  readonly "_deckNavbar": {
    /** オンラインモードに切り替え */
    readonly "switchToOnline": string
    /** オフラインモードに切り替え */
    readonly "switchToOffline": string
    /** ポーリングモードに切り替え */
    readonly "switchToPolling": string
    /** リアルタイムモードに切り替え */
    readonly "switchToRealtime": string
    /** もっと */
    readonly "more": string
    /** オンライン */
    readonly "online": string
    /** リアルタイム */
    readonly "realtime": string
    /** ナビバー編集 */
    readonly "editNavbar": string
    /** オフラインモードを解除 */
    readonly "disableOfflineTitle": string
    /** オフラインモードに切り替え */
    readonly "enableOfflineTitle": string
    /** サーバーに再接続します。 */
    readonly "disableOfflineMessage": string
    /** すべての通信を停止し、キャッシュ済みデータのみ表示します。 */
    readonly "enableOfflineMessage": string
    /** 解除 */
    readonly "turnOff": string
    /** ポーリングモードに切り替え */
    readonly "pollingTitle": string
    /** リアルタイムモードに切り替え */
    readonly "realtimeTitle": string
    /** WebSocket 接続を切断し、定期的な HTTP ポーリングに切り替えます。 */
    readonly "pollingMessage": string
    /** リアルタイム更新に切り替えます。 */
    readonly "realtimeMessage": string
    /** 権限がありません。write:account の権限を付与するために再ログインしてください。 */
    readonly "permissionDenied": string
    /** {account} のキャッシュを削除しますか？ */
    readonly "clearCacheConfirm": ParameterizedString<'account'>
  }
  readonly "_deckNotificationColumn": {
    /** 通知はありません */
    readonly "empty": string
    /** 他 {count} 人 */
    readonly "othersCount_plural": PluralString<'count'>
    /** 承認済み */
    readonly "accepted": string
    /** 拒否済み */
    readonly "rejected": string
    /** 承認 */
    readonly "accept": string
    /** 拒否 */
    readonly "reject": string
    /** 心当たりがない場合は{link}を通じてアクセストークンを削除してください。 */
    readonly "createTokenWarning": ParameterizedString<'link'>
    /** アクセストークンの管理 */
    readonly "manageAccessTokens": string
    /** ユーザープロフィール */
    readonly "openUserProfile": string
    /** ノートを表示 */
    readonly "openNote": string
    /** ノートの Raw JSON */
    readonly "noteRawJson": string
    /** 通知の Raw JSON */
    readonly "notificationRawJson": string
    /** すべて */
    readonly "filterAll": string
    /** リプライ */
    readonly "filterReply": string
    /** 引用 */
    readonly "filterQuote": string
    /** メンション */
    readonly "filterMention": string
    /** フォロー */
    readonly "filterFollow": string
    /** アンケート */
    readonly "filterPollEnded": string
    /** 実績 */
    readonly "filterAchievementEarned": string
    /** トークン */
    readonly "filterCreateToken": string
    /** がリアクション */
    readonly "labelReaction": string
    /** からのリプライ */
    readonly "labelReply": string
    /** がリノートしました */
    readonly "labelRenote": string
    /** による引用 */
    readonly "labelQuote": string
    /** からのメンション */
    readonly "labelMention": string
    /** にフォローされました */
    readonly "labelFollow": string
    /** がフォローリクエストを承認 */
    readonly "labelFollowRequestAccepted": string
    /** からフォローリクエスト */
    readonly "labelReceiveFollowRequest": string
    /** アンケートの結果が出ました */
    readonly "labelPollEnded": string
    /** 実績を獲得 */
    readonly "labelAchievementEarned": string
    /** ロールが付与されました */
    readonly "labelRoleAssigned": string
    /** 通知 */
    readonly "labelApp": string
    /** ログインがありました */
    readonly "labelLogin": string
    /** アクセストークンが作成されました */
    readonly "labelCreateToken": string
    /** テスト通知 */
    readonly "labelTest": string
  }
  readonly "_deckPluginManagerColumn": {
    /** 新規プラグインを作成 */
    readonly "create": string
    /** プラグイン */
    readonly "safeModeSubject": string
    /** インストール済みを探す */
    readonly "searchInstalled": string
    /** 有効なプラグイン */
    readonly "enabledPlugins": string
    /** 無効なプラグイン */
    readonly "disabledPlugins": string
    /** 一致するプラグインがありません */
    readonly "noMatches": string
    /** このカラムに追加されたプラグインはありません */
    readonly "emptyInColumn": string
    /** ライブラリに追加可能なプラグインがありません。 */
    readonly "noLibraryCandidates": string
    /** プラグインを外しました */
    readonly "detached": string
    /** 全アカウント対象から外す */
    readonly "detachFromAllAccounts": string
    /** プラグインを削除 */
    readonly "deleteTitle": string
    /** 「{name}」をライブラリから削除しますか？プラグインのコードも消えます。 */
    readonly "deleteConfirm": ParameterizedString<'name'>
    /** プラグインを削除しました */
    readonly "deleted": string
  }
  readonly "_deckQueryManagerColumn": {
    /** 新規クエリを作成 */
    readonly "create": string
    /** クエリ */
    readonly "safeModeSubject": string
    /** クエリを探す */
    readonly "search": string
    /** 有効なクエリ */
    readonly "enabledQueries": string
    /** 無効なクエリ */
    readonly "disabledQueries": string
    /** 一致するクエリがありません */
    readonly "noMatches": string
    /** 名前付きクエリはまだありません */
    readonly "empty": string
    /** クエリはカラムの視界を定義する AiScript 式です。作成すると 各ノートカラムのクエリ設定からトグルで適用できます。 */
    readonly "emptyHint": string
    /** クエリを作成 */
    readonly "createQuery": string
    /** ライブラリに追加可能なクエリがありません。 */
    readonly "noLibraryCandidates": string
    /** クエリを外しました */
    readonly "detached": string
    /** 全アカウント対象から外す */
    readonly "detachFromAllAccounts": string
    /** 「{name}」は {count} 個のカラムに適用中です。削除するとそれらのカラムは評価不能 (fail-closed) になります。削除しますか？ */
    readonly "deleteConfirmInUse_plural": PluralString<'count' | 'name'>
    /** 「{name}」は無効ですが、{count} 個のカラムに適用中です。削除するとそれらのカラムは評価不能 (fail-closed) になります。削除しますか？ */
    readonly "deleteConfirmInUseDisabled_plural": PluralString<'count' | 'name'>
    /** クエリを削除 */
    readonly "deleteTitle": string
    /** 「{name}」を削除しますか？クエリの本文も消えます。 */
    readonly "deleteConfirm": ParameterizedString<'name'>
    /** クエリを削除しました */
    readonly "deleted": string
    /** 新しいクエリ {n} */
    readonly "newQueryName": ParameterizedString<'n'>
    /** キーワード */
    readonly "newQueryKeyword": string
  }
  readonly "_deckServerInfoColumn": {
    /** (説明なし) */
    readonly "noDescription": string
    /** ソースコード */
    readonly "sourceCode": string
    /** 管理者 */
    readonly "maintainer": string
    /** 連絡先 */
    readonly "contact": string
    /** 問い合わせ */
    readonly "inquiry": string
    /** (なし) */
    readonly "none": string
    /** 運営情報 */
    readonly "impressum": string
    /** サーバールール */
    readonly "serverRules": string
    /** 利用規約 */
    readonly "tos": string
    /** プライバシーポリシー */
    readonly "privacyPolicy": string
    /** フィードバック */
    readonly "feedback": string
    /** 統計 */
    readonly "stats": string
    /** サーバー情報を取得できませんでした */
    readonly "fetchFailed": string
    /** 情報 */
    readonly "info": string
  }
  readonly "_deckSkillColumn": {
    /** 新規スキルを作成 */
    readonly "create": string
    /** スキルを探す */
    readonly "search": string
    /** HEARTBEAT 対象から外す */
    readonly "removeFromHeartbeat": string
    /** HEARTBEAT で定期実行する */
    readonly "addToHeartbeat": string
    /** ライブラリから削除 (本文も消えます) */
    readonly "deleteFromLibrary": string
    /** 無効化 */
    readonly "deactivate": string
    /** 有効化 */
    readonly "activate": string
    /** mode=always は常時有効 */
    readonly "alwaysActive": string
    /** 一致するスキルがありません */
    readonly "noMatches": string
    /** スキルがインストールされていません */
    readonly "empty": string
    /** インストール済み */
    readonly "installedMark": string
    /** ストアに登録済みのスキルはありません */
    readonly "storeEmpty": string
    /** スキルを削除 */
    readonly "deleteTitle": string
    /** 「{name}」を削除しますか？スキルの本文も消えます。 */
    readonly "deleteConfirm": ParameterizedString<'name'>
    /** スキルを削除しました */
    readonly "deleted": string
    /** 常時 */
    readonly "modeAlways": string
    /** 手動 */
    readonly "modeManual": string
    /** 自動 */
    readonly "modeTrigger": string
    /** 新規スキル */
    readonly "newSkillName": string
    /** 指示文をここに記述します。 */
    readonly "newSkillBody": string
  }
  readonly "_deckTaskRunnerColumn": {
    /** 履歴をクリア */
    readonly "clearHistory": string
    /** tasks.json5 を編集 */
    readonly "editTasksFile": string
    /** {label} を実行 */
    readonly "runTask": ParameterizedString<'label'>
    /** デフォルト実行 */
    readonly "defaultRun": string
    /** タスクを検索 */
    readonly "search": string
    /** tasks.json5 を編集してタスクを定義すると、ここから 1-click で実行できます。 */
    readonly "empty": string
    /** "{query}" に一致するタスクはありません */
    readonly "noMatches": ParameterizedString<'query'>
    /** エラー */
    readonly "error": string
    /** 最終実行: {status} · {duration} */
    readonly "lastRun": ParameterizedString<'duration' | 'status'>
    /** 入力を求める */
    readonly "requiresInput": string
    /** AI セッションで実行 (kind=task の新規セッションを作成し、即 1 回実行) */
    readonly "runWithAi": string
    /** {n} 実行中 */
    readonly "runningCount": ParameterizedString<'n'>
    /** 実行履歴はまだありません */
    readonly "noHistory": string
    /** AI 接続が未選択、または model が未設定のため AI 実行できません */
    readonly "aiNotConfigured": string
  }
  readonly "_queryCard": {
    /** 本体を無効にしています。適用先のカラムでは評価されません */
    readonly "disabledHint": string
    /** 逐次適用 */
    readonly "degraded": string
    /** 1 件ずつ判定します。絞り込みは効きますが、キャッシュ検索には使えません */
    readonly "degradedHint": string
    /** 評価不能 */
    readonly "invalid": string
    /** 解釈できないため適用中のカラムは新着を停止します (編集して修正してください) */
    readonly "invalidHint": string
    /** {count} カラムで適用中 */
    readonly "appliedInColumns_plural": PluralString<'count'>
    /** ライブラリから削除 (本文も消えます) */
    readonly "deleteFromLibrary": string
    /** ソースファイルが見つからないため変更できません */
    readonly "readOnlyHint": string
  }
  readonly "_addColumnDialog": {
    /** {label}を選択 */
    readonly "selectItem": ParameterizedString<'label'>
    /** アカウントを選択 */
    readonly "selectAccount": string
    /** {label}名を入力... */
    readonly "itemNamePlaceholder": ParameterizedString<'label'>
    /** 作成 */
    readonly "create": string
    /** 新しい{label}を作成 */
    readonly "createNew": ParameterizedString<'label'>
    /** {label}が見つかりません */
    readonly "notFound": ParameterizedString<'label'>
    /** アカウントなし */
    readonly "noAccount": string
    /** ゲストアカウントではこのカラムを使えません */
    readonly "guestUnavailable": string
    /** ログインすると利用できます */
    readonly "loginRequired": string
  }
  readonly "_columnErrorBoundary": {
    /** カラムの表示中に問題が発生しました */
    readonly "title": string
  }
  readonly "_columnFilterButton": {
    /** フィルター */
    readonly "filter": string
  }
  readonly "_columnQueryBanners": {
    /** このカラムが参照しているクエリは削除されています。外すと新着の取り込みが戻ります */
    readonly "queryDeletedHint": string
    /** 参照しているクエリが見つかりません */
    readonly "queryNotFound": string
    /** 参照を外す */
    readonly "detach": string
    /** クエリを解釈できないため新着を停止中 */
    readonly "queryInvalid": string
    /** クエリの処理が終わらなかったため停止しました。再開すると取得し直します */
    readonly "suspendedHint": string
    /** {count} 件保留中 */
    readonly "pending_plural": PluralString<'count'>
    /** クエリを停止中 */
    readonly "querySuspended": string
    /** 再開 */
    readonly "resume": string
  }
  readonly "_columnTombstone": {
    /** 拡張カラム「{type}」は読み込まれていません */
    readonly "notLoaded": ParameterizedString<'type'>
    /** 提供元のプラグインが無効・削除されているか、まだ起動していません。 */
    readonly "bodyReason": string
    /** プラグインが起動すると自動的に表示されます。 */
    readonly "bodyAuto": string
    /** このカラムを削除 */
    readonly "removeColumn": string
  }
  readonly "_dayNightToggle": {
    /** ライトモードに切り替え */
    readonly "switchToLight": string
    /** ダークモードに切り替え */
    readonly "switchToDark": string
    /** ライト */
    readonly "light": string
    /** ダーク */
    readonly "dark": string
    /** デバイスのダークモードに同期 */
    readonly "syncWithDevice": string
  }
  readonly "_deckAboutMisskeyColumn": {
    /** Misskey はオープンソースの分散型ソーシャルネットワーキングプラットフォームです。 */
    readonly "description": string
    /** もっと詳しく */
    readonly "learnMore": string
    /** ソースコード (オリジナル) */
    readonly "sourceCodeOriginal": string
    /** 翻訳 */
    readonly "translation": string
    /** 寄付 */
    readonly "donate": string
    /** このサーバーは Misskey の改変版を使用しています。 */
    readonly "modifiedNotice": string
    /** ソースコード */
    readonly "sourceCode": string
    /** プロジェクトメンバー */
    readonly "projectMembers": string
    /** 情報を取得できませんでした */
    readonly "fetchFailed": string
  }
  readonly "_deckAchievementsColumn": {
    /** 開発者モードを有効にすると挑戦できます */
    readonly "pendingHint": string
    /** 実績がありません */
    readonly "empty": string
  }
  readonly "_deckAdsColumn": {
    /** 広告はありません */
    readonly "empty": string
  }
  readonly "_deckAiScriptColumn": {
    /** 実行中... */
    readonly "running": string
    /** 実行 (Ctrl+Enter) */
    readonly "runWithShortcut": string
    /** 出力 */
    readonly "output": string
    /** Ctrl+Enter で実行 */
    readonly "runHint": string
    /** UI コンポーネントなし */
    readonly "noUiComponents": string
  }
  readonly "_deckAnnouncementsColumn": {
    /** お知らせはありません */
    readonly "empty": string
    /** 既読にする */
    readonly "markAsRead": string
  }
  readonly "_deckApiConsoleColumn": {
    /** パラメーター (JSON) */
    readonly "params": string
    /** アカウントが設定されていません */
    readonly "noAccount": string
    /** ログアウト中 */
    readonly "loggedOut": string
    /** Ctrl+Enter で送信 */
    readonly "sendHint": string
    /** 送信中... */
    readonly "sending": string
    /** エンドポイントを入力してください */
    readonly "enterEndpoint": string
    /** アカウントを選択してください */
    readonly "selectAccount": string
    /** 送信 (Ctrl+Enter) */
    readonly "sendWithShortcut": string
    /** パラメーターの JSON が不正です */
    readonly "invalidParamsJson": string
  }
  readonly "_deckBottomBar": {
    /** デッキ設定 */
    readonly "deckSettings": string
  }
  readonly "_deckChartsColumn": {
    /** 時 */
    readonly "hour": string
    /** 日 */
    readonly "day": string
    /** 内訳 */
    readonly "breakdown": string
    /** サーバー統計を取得できません */
    readonly "fetchFailed": string
    /** このサーバーのチャートはログインユーザー限定です */
    readonly "loginRequired": string
    /** このサーバーはチャート API を無効にしています */
    readonly "chartsDisabled": string
  }
  readonly "_deckChatColumn": {
    /** 検索を閉じる */
    readonly "closeSearch": string
    /** メッセージを検索 */
    readonly "searchMessages": string
    /** チャットを検索... */
    readonly "searchChatsPlaceholder": string
    /** 会話はありません */
    readonly "noConversations": string
    /** 一致するチャットがありません */
    readonly "noMatchingChats": string
    /** (ファイル) */
    readonly "fileOnly": string
    /** メッセージを検索... */
    readonly "searchMessagesPlaceholder": string
    /** 一致するメッセージがありません */
    readonly "noMatchingMessages": string
    /** メッセージ... */
    readonly "messagePlaceholder": string
  }
  readonly "_deckColumnsArea": {
    /** カラムがありません */
    readonly "noColumns": string
    /** デフォルトの構成で始める */
    readonly "startWithDefault": string
  }
  readonly "_deckEmojiColumn": {
    /** 絵文字を検索... */
    readonly "searchPlaceholder": string
    /** {count} 件 */
    readonly "count_plural": PluralString<'count'>
    /** すべて */
    readonly "all": string
    /** 絵文字が見つかりません */
    readonly "noEmoji": string
    /** {name} (ミュート中) */
    readonly "emojiMuted": ParameterizedString<'name'>
    /** 未分類 */
    readonly "uncategorized": string
    /** ミュート中 */
    readonly "muted": string
    /** この絵文字をミュート */
    readonly "muteEmoji": string
  }
  readonly "_deckExploreColumn": {
    /** ノートが見つかりません */
    readonly "noNotes": string
    /** ユーザー情報 */
    readonly "userInfo": string
    /** ユーザーが見つかりません */
    readonly "noUsers": string
    /** ユーザーがいません */
    readonly "noRoleUsers": string
    /** ロールが見つかりません */
    readonly "noRoles": string
    /** ロール */
    readonly "tabRoles": string
  }
  readonly "_deckFavoritesColumn": {
    /** お気に入りはありません */
    readonly "empty": string
  }
  readonly "_deckFederationColumn": {
    /** ホスト名で検索... */
    readonly "searchPlaceholder": string
    /** 連合情報 */
    readonly "federationInfo": string
    /** 連合中のサーバーが見つかりません */
    readonly "empty": string
    /** {host}
{software}
ユーザー: {users} / ノート: {notes}
最終通信: {lastSent} */
    readonly "instanceTooltip": ParameterizedString<'host' | 'lastSent' | 'notes' | 'software' | 'users'>
    /** 停止中 */
    readonly "suspended": string
    /** 無応答 */
    readonly "notResponding": string
    /** アクティブ */
    readonly "sortActive": string
    /** 新着 */
    readonly "sortNewest": string
  }
  readonly "_deckFollowRequestsColumn": {
    /** 承認済み */
    readonly "accepted": string
    /** 拒否済み */
    readonly "rejected": string
    /** 取り消し済み */
    readonly "canceled": string
    /** 取り消し */
    readonly "cancelRequest": string
    /** 承認 */
    readonly "accept": string
    /** 拒否 */
    readonly "reject": string
    /** 受け取った申請 */
    readonly "received": string
    /** 送った申請 */
    readonly "sent": string
    /** 送信中のフォローリクエストはありません */
    readonly "noSentRequests": string
    /** フォローリクエストはありません */
    readonly "noRequests": string
  }
  readonly "_deckGalleryColumn": {
    /** ギャラリーの投稿がありません */
    readonly "empty": string
    /** 「{title}」のメニュー */
    readonly "postMenu": ParameterizedString<'title'>
  }
  readonly "_deckLayout": {
    /** 新しいノート */
    readonly "newNote": string
    /** ファイルをドロップしてアップロード */
    readonly "dropToUpload": string
    /** ここにカラムを移動 */
    readonly "moveColumnHere": string
    /** ログインすると投稿できます */
    readonly "loginToPost": string
  }
  readonly "_deckLookupColumn": {
    /** URL または @ユーザー名@ホスト */
    readonly "placeholder": string
    /** URL を入力して照会 */
    readonly "emptyThread": string
    /** URL または @ユーザー名を入力して照会 */
    readonly "emptyResult": string
    /** アダプターの初期化に失敗しました */
    readonly "adapterInitFailed": string
    /** 照会できませんでした */
    readonly "lookupFailed": string
    /** ログイン済みアカウントがありません */
    readonly "noLoggedInAccount": string
    /** ユーザー照会は単一アカウントモードで行ってください */
    readonly "userLookupSingleAccountOnly": string
  }
  readonly "_deckMemoColumn": {
    /** メモはありません */
    readonly "empty": string
    /** このメモをエディターで開く */
    readonly "openInEditor": string
    /** 投稿フォームに復元 */
    readonly "restoreToPostForm": string
    /** チャンネル投稿 */
    readonly "contextChannelNote": string
    /** メモを削除 */
    readonly "deleteTitle": string
    /** 選択したメモを削除しますか？ */
    readonly "deleteConfirm": string
    /** メモを削除しました */
    readonly "deleted": string
  }
  readonly "_deckMentionsColumn": {
    /** ダイレクトメッセージはありません */
    readonly "directEmpty": string
    /** あなた宛て */
    readonly "toYou": string
    /** メンションはありません */
    readonly "mentionsEmpty": string
  }
  readonly "_deckNoteColumn": {
    /** まだノートがありません */
    readonly "noNotesYet": string
    /** オフラインモード */
    readonly "offlineMode": string
    /** オフライン (サーバーへのリクエストに失敗) */
    readonly "offlineRequestFailed": string
    /** 再接続中 ({duration}) */
    readonly "reconnectingSince": ParameterizedString<'duration'>
    /** 切断 ({duration}) */
    readonly "disconnectedSince": ParameterizedString<'duration'>
    /** クエリを解釈できないため表示を停止中です */
    readonly "queryInvalid": string
    /** クエリに合致するノートがありません ({count} 件を除外中) */
    readonly "queryExcludedAll_plural": PluralString<'count'>
  }
  readonly "_deckTimelineColumn": {
    /** ローカル */
    readonly "local": string
    /** ソーシャル */
    readonly "social": string
    /** グローバル */
    readonly "global": string
    /** クエリを解釈できないため表示を停止中です */
    readonly "queryInvalid": string
    /** クエリに合致するノートがありません ({count} 件を除外中) */
    readonly "queryExcludedAll_plural": PluralString<'count'>
    /** ノートはありません */
    readonly "noNotes": string
  }
  readonly "_deckPageColumn": {
    /** ページが見つかりません */
    readonly "empty": string
    /** 人気 */
    readonly "featured": string
    /** 自分の */
    readonly "my": string
    /** いいね */
    readonly "likes": string
  }
  readonly "_deckPlayColumn": {
    /** Play が見つかりません */
    readonly "empty": string
    /** 人気 */
    readonly "featured": string
    /** 自分の */
    readonly "my": string
    /** いいね */
    readonly "likes": string
  }
  readonly "_deckProfileMenu": {
    /** エディターで開く */
    readonly "openInEditor": string
    /** 保存されたプロファイルはありません */
    readonly "noProfiles": string
    /** 新規プロファイル */
    readonly "newProfile": string
    /** プロファイルを削除 */
    readonly "deleteTitle": string
    /** このプロファイルを削除しますか？ */
    readonly "deleteConfirm": string
    /** プロファイルを削除しました */
    readonly "deleted": string
  }
  readonly "_deckSearchColumn": {
    /** 正規表現で検索... */
    readonly "regexPlaceholder": string
    /** ノートを検索... */
    readonly "placeholder": string
    /** 正規表現モード */
    readonly "regexMode": string
    /** 正規表現ガイド */
    readonly "regexGuide": string
    /** 日付フィルター */
    readonly "dateFilter": string
    /** 古い順 */
    readonly "oldestFirst": string
    /** 新しい順 */
    readonly "newestFirst": string
    /** 開始日 */
    readonly "startDate": string
    /** 終了日 */
    readonly "endDate": string
    /** 日付クリア */
    readonly "clearDate": string
    /** 検索クエリを入力 */
    readonly "enterQuery": string
    /** 結果が見つかりませんでした */
    readonly "noResults": string
    /** Enter キーでサーバーを検索 */
    readonly "enterToSearch": string
    /** 無効な正規表現です */
    readonly "invalidRegex": string
  }
  readonly "_deckStreamInspectorColumn": {
    /** 再開 */
    readonly "resume": string
    /** 一時停止 */
    readonly "pause": string
    /** イベント待機中... */
    readonly "waiting": string
  }
  readonly "_deckThemeManagerColumn": {
    /** 新規テーマを作成 */
    readonly "createTheme": string
    /** テーマ */
    readonly "safeModeSubject": string
    /** インストール済みを探す */
    readonly "searchInstalled": string
    /** ライブラリに追加可能なテーマがありません。 */
    readonly "noLibraryThemes": string
    /** 一致するテーマがありません */
    readonly "noMatches": string
    /** テーマがありません */
    readonly "noThemes": string
    /** ストアからインストール... */
    readonly "installFromStore": string
    /** テーマを削除 */
    readonly "deleteTitle": string
    /** 「{name}」はこのアカウントにのみ紐付いています。外すとテーマ自体が削除されます。削除しますか？ */
    readonly "deleteLastAccountConfirm": ParameterizedString<'name'>
    /** テーマを削除しました */
    readonly "deleted": string
    /** テーマを外しました */
    readonly "detached": string
    /** 「{name}」を削除しますか？テーマの設定も消えます。 */
    readonly "deleteConfirm": ParameterizedString<'name'>
  }
  readonly "_deckWidgetColumn": {
    /** 新規ローカルウィジェットを作成 */
    readonly "createLocal": string
    /** ウィジェットを追加してカスタマイズしよう */
    readonly "empty": string
    /** ウィジェットを追加 */
    readonly "addWidget": string
    /** ライブラリに配置可能なウィジェットがありません。 */
    readonly "noLibraryWidgets": string
    /** 空のコード */
    readonly "emptyCode": string
    /** 一致するウィジェットがありません */
    readonly "noMatches": string
    /** アカウントを選択 */
    readonly "selectAccount": string
    /** ウィジェットを外しました */
    readonly "detached": string
    /** ウィジェットをどのアカウントで動かしますか？ */
    readonly "pickAccountForNew": string
    /** 「{name}」をどのアカウントで動かしますか？ */
    readonly "pickAccountFor": ParameterizedString<'name'>
    /** ウィジェットを削除 */
    readonly "deleteTitle": string
    /** 「{name}」をライブラリから削除しますか？ウィジェットのコードも消えます。 */
    readonly "deleteConfirm": ParameterizedString<'name'>
    /** ウィジェットを削除しました */
    readonly "deleted": string
  }
  readonly "_deckWindow": {
    /** Web UI で開く */
    readonly "openInWebUi": string
    /** OS のデフォルトエディターで {name} を開く */
    readonly "openInDefaultEditor": ParameterizedString<'name'>
    /** 最小化 */
    readonly "minimize": string
    /** 最大化 */
    readonly "maximize": string
    /** @{username} のフォロー / フォロワー */
    readonly "followListTitle": ParameterizedString<'username'>
  }
  readonly "_logoutDialog": {
    /** ゲストを削除 */
    readonly "removeGuest": string
    /** このゲストアカウントを削除しますか？ */
    readonly "confirmRemoveGuest": string
    /** ローカルデータをこのデバイスに残しますか？ */
    readonly "keepDataQuestion": string
    /** 残したデータはオフラインで閲覧できます。 */
    readonly "keptDataHint": string
    /** すべて削除 */
    readonly "deleteAll": string
    /** データを残す */
    readonly "keepData": string
  }
  readonly "_navAccountMenu": {
    /** コントロールパネル */
    readonly "controlPanel": string
  }
  readonly "_pluginCard": {
    /** 非対応 */
    readonly "incompatible": string
    /** 権限がないため拒否されました: {target} (要求: {keys} / {count} 回)。クリックでプラグイン権限を開く */
    readonly "denied_plural": PluralString<'count' | 'keys' | 'target'>
    /** このカラムから外す */
    readonly "detachFromColumn": string
    /** ライブラリから削除 (コードも消えます) */
    readonly "deleteFromLibrary": string
  }
  readonly "_widgetCard": {
    /** 非対応 */
    readonly "incompatible": string
    /** ライブラリから削除 (コードも消えます) */
    readonly "deleteFromLibrary": string
    /** ウィジェットを編集 */
    readonly "editWidget": string
    /** 配置 */
    readonly "place": string
  }
  readonly "_themeCard": {
    /** このアカウントの設定を解除 */
    readonly "clearAccount": string
    /** ライブラリから削除 (テーマも消えます) */
    readonly "deleteFromLibrary": string
    /** このアカウントに追加 */
    readonly "addToAccount": string
    /** MisStore で詳細を見る */
    readonly "viewInMisStore": string
    /** インストール中 */
    readonly "installing": string
  }
  readonly "_timelineFilterPopup": {
    /** フィルター */
    readonly "filter": string
    /** このクエリは無効です — 押すとクエリ管理カラムを開きます */
    readonly "disabledQueryHint": string
    /** リプライ */
    readonly "withReplies": string
    /** ファイル付きのみ */
    readonly "withFiles": string
    /** センシティブ */
    readonly "withSensitive": string
  }
  readonly "_widgetAiScript": {
    /** コードを編集 */
    readonly "editCode": string
    /** 実行中... */
    readonly "running": string
    /** ドラッグして並び替え */
    readonly "dragToReorder": string
    /** サイドバーから外す */
    readonly "removeFromSidebar": string
    /** このカラムから外す */
    readonly "removeFromColumn": string
    /** 出力 ({n}) */
    readonly "outputCount": ParameterizedString<'n'>
    /** セーフモードのため実行されません */
    readonly "safeModeBlocked": string
  }
  readonly "_performanceData": {
    readonly "units": {
      /** 件 */
      readonly "items": string
      /** ホスト */
      readonly "hosts": string
      /** 並列 */
      readonly "parallel": string
      /** 回 */
      readonly "times": string
      /** 回/秒 */
      readonly "timesPerSecond": string
      /** 秒 */
      readonly "seconds": string
      /** 日 */
      readonly "days": string
      /** 分 */
      readonly "minutes": string
      /** 本 */
      readonly "columns": string
      /** 枚 */
      readonly "images": string
      /** フレーム */
      readonly "frames": string
    }
    readonly "categories": {
      readonly "emoji": {
        /** 絵文字キャッシュ */
        readonly "label": string
      }
      readonly "cache": {
        /** パースキャッシュ */
        readonly "label": string
        /** パース */
        readonly "short": string
      }
      readonly "realtime": {
        /** リアルタイム */
        readonly "label": string
        /** リアル */
        readonly "short": string
      }
      readonly "backend": {
        /** バックエンド */
        readonly "label": string
        /** バック */
        readonly "short": string
      }
      readonly "css": {
        /** CSS 描画 */
        readonly "label": string
        /** CSS */
        readonly "short": string
      }
      readonly "polling": {
        /** 取得 */
        readonly "short": string
      }
      readonly "telemetry": {
        /** テレメトリ */
        readonly "label": string
        /** 計測 */
        readonly "short": string
      }
      readonly "interaction": {
        /** インタラクション */
        readonly "label": string
        /** 操作 */
        readonly "short": string
      }
    }
    readonly "labels": {
      /** 辞書保持ホスト数 */
      readonly "emojiCacheHosts": string
      /** リスト保持ホスト数 */
      readonly "emojiListHosts": string
      /** localStorage 永続化/ホスト */
      readonly "emojiPersistPerHost": string
      /** ノートストア上限 */
      readonly "noteStoreMax": string
      /** DOM 表示上限/カラム */
      readonly "noteListMax": string
      /** 通知保持上限 */
      readonly "maxNotifications": string
      /** チャットメッセージストア上限 */
      readonly "chatMessageStoreMax": string
      /** MFM キャッシュ */
      readonly "mfmCacheMax": string
      /** blurhash キャッシュ */
      readonly "blurhashCacheMax": string
      /** プロキシ URL キャッシュ */
      readonly "imageProxyCacheMax": string
      /** OGP キャッシュ */
      readonly "ogpCacheMax": string
      /** Note Capture 上限 */
      readonly "noteCaptureMax": string
      /** Overscan */
      readonly "overscan": string
      /** メモリキャッシュ合計 */
      readonly "memoryCacheMaxMB": string
      /** 単一ファイル上限 */
      readonly "memoryCacheMaxItemKB": string
      /** 並行フェッチ数 */
      readonly "maxConcurrentFetches": string
      /** Rust OGP キャッシュ */
      readonly "rustOgpCacheMax": string
      /** レート制限 */
      readonly "maxRequestsPerWindow": string
      /** サーキットブレーカー閾値 */
      readonly "circuitBreakerThreshold": string
      /** サーキットブレーカー期間 */
      readonly "circuitBreakerDuration": string
      /** 画像キャッシュ有効期限 */
      readonly "imageCacheTTLDays": string
      /** 画像キャッシュ上限 */
      readonly "imageCacheMaxMB": string
      /** 1 ファイルの取得上限 */
      readonly "imageCacheMaxFileMB": string
      /** 先読みプリフェッチ */
      readonly "prefetchAhead": string
      /** 後方プリフェッチ */
      readonly "prefetchBehind": string
      /** プリフェッチ追跡上限 */
      readonly "prefetchTrackedMax": string
      /** 遅延読み込みマージン */
      readonly "lazyLoadMargin": string
      /** Viewport 近傍バッファ */
      readonly "nearViewportBuffer": string
      /** OGP ギャラリー上限 */
      readonly "ogpGalleryMax": string
      /** 埋め込みノートキャッシュ */
      readonly "embedCacheMax": string
      /** ブラー強度 */
      readonly "cssBlurLevel": string
      /** アニメーション速度 */
      readonly "cssAnimationScale": string
      /** シャドウ強度 */
      readonly "cssShadowLevel": string
      /** ストリームポーリング間隔 */
      readonly "streamPollingInterval": string
      /** 通知ポーリング間隔 */
      readonly "notificationPollInterval": string
      /** チャットポーリング間隔 */
      readonly "chatPollInterval": string
      /** 同時 live カラム数 */
      readonly "maxLiveColumns": string
      /** カラムアンロード遅延 */
      readonly "columnUnloadDelay": string
      /** スナップショット保存数 */
      readonly "snapshotMaxNotes": string
      /** スナップショット有効期限 */
      readonly "snapshotTTL": string
      /** ジャンク検出感度 */
      readonly "jankDowngradeThreshold": string
      /** アップグレード待機 */
      readonly "stableUpgradeSeconds": string
      /** ノート出現アニメーション */
      readonly "noteAnimationDuration": string
      /** P95 履歴サイズ */
      readonly "frameHistorySize": string
      /** 通知音キャッシュ */
      readonly "soundCacheMax": string
      /** タイムラインキャッシュ読み込み */
      readonly "cachedTimelineLimit": string
      /** プルリフレッシュ距離 */
      readonly "pullFireThreshold": string
      /** スワイプ切り替え距離 */
      readonly "swipeThreshold": string
      /** フリック速度 */
      readonly "flingVelocity": string
      /** ホイールクールダウン */
      readonly "wheelCooldown": string
      /** ナビバー非表示感度 */
      readonly "scrollHideThreshold": string
    }
    readonly "descriptions": {
      /** 絵文字を解決するための辞書を保持するホスト数。連合先が増えるほど育つので上限で頭を打たせる */
      readonly "emojiCacheHosts": string
      /** リアクションピッカー用の絵文字リストを保持するホスト数 */
      readonly "emojiListHosts": string
      /** オフライン時の絵文字解決用に localStorage に保存するエントリ数 */
      readonly "emojiPersistPerHost": string
      /** グローバルノートストアの保持上限。長時間セッションのメモリ消費に影響 */
      readonly "noteStoreMax": string
      /** カラムあたりのデータ配列上限。超過分はスクロール時に破棄 */
      readonly "noteListMax": string
      /** 通知カラムに保持する通知の最大数 */
      readonly "maxNotifications": string
      /** グローバル chatMessageStore の保持上限。長時間チャットしている場合のメモリに影響 (#460) */
      readonly "chatMessageStoreMax": string
      /** MFM パース結果の LRU キャッシュ上限 */
      readonly "mfmCacheMax": string
      /** 画像ロード前のプレースホルダー (blurhash → data URL) の LRU キャッシュ上限 */
      readonly "blurhashCacheMax": string
      /** プロキシ URL 変換の LRU キャッシュ上限 */
      readonly "imageProxyCacheMax": string
      /** OGP プレビューの LRU キャッシュ上限 */
      readonly "ogpCacheMax": string
      /** リアルタイム更新の WebSocket 購読数。多いほどリアクション即時反映 */
      readonly "noteCaptureMax": string
      /** viewport 外に余分に描画するノート数。多いほどスクロールが滑らか */
      readonly "overscan": string
      /** 画像のインメモリキャッシュ合計サイズ */
      readonly "memoryCacheMaxMB": string
      /** メモリキャッシュに載せる単一ファイルの最大サイズ */
      readonly "memoryCacheMaxItemKB": string
      /** 画像の同時ダウンロード数 */
      readonly "maxConcurrentFetches": string
      /** Rust 側の OGP メタデータ LRU キャッシュ上限 */
      readonly "rustOgpCacheMax": string
      /** ホストあたりの 1 分間リクエスト上限 */
      readonly "maxRequestsPerWindow": string
      /** この回数連続失敗でホストを一時遮断 */
      readonly "circuitBreakerThreshold": string
      /** 遮断されたホストの復帰までの待機時間 */
      readonly "circuitBreakerDuration": string
      /** ディスク上の画像キャッシュの保持日数 */
      readonly "imageCacheTTLDays": string
      /** 超過した分は古いものから削除される */
      readonly "imageCacheMaxMB": string
      /** これを超える画像はプロキシを通さない。上げるとピークメモリも増える */
      readonly "imageCacheMaxFileMB": string
      /** viewport 下方向に先読みする画像プリフェッチ数 */
      readonly "prefetchAhead": string
      /** viewport 上方向に遡って画像プリフェッチする数 */
      readonly "prefetchBehind": string
      /** プリフェッチ済み URL の記憶数。超過すると古い順に破棄 */
      readonly "prefetchTrackedMax": string
      /** OGP プレビューや埋め込みノートの読み込みを開始する viewport からの距離 */
      readonly "lazyLoadMargin": string
      /** viewport 端から画像を eager 読み込みする余裕アイテム数 */
      readonly "nearViewportBuffer": string
      /** OGP プレビューのギャラリー画像の最大表示枚数 */
      readonly "ogpGalleryMax": string
      /** 埋め込みノートの LRU キャッシュ上限 */
      readonly "embedCacheMax": string
      /** backdrop-filter ブラーの強度。0=無効、1=軽量 (1–2px)、2=フル (4px)。最も GPU 負荷が高い */
      readonly "cssBlurLevel": string
      /** トランジション・アニメーションの速度スケール。0%で即時描画、100%で通常速度 */
      readonly "cssAnimationScale": string
      /** box-shadow の描画レベル。0=無効、1=軽量、2=フル (Misskey 準拠) */
      readonly "cssShadowLevel": string
      /** ポーリングモード時のタイムライン更新間隔。短いほどリアルタイムに近い */
      readonly "streamPollingInterval": string
      /** 通知未読数の確認間隔。短いほどリアルタイム、長いほどバッテリー節約 */
      readonly "notificationPollInterval": string
      /** チャット未読の確認間隔 */
      readonly "chatPollInterval": string
      /** ストリーミング接続を維持するカラムの上限。超過分は一時停止される */
      readonly "maxLiveColumns": string
      /** 画面外カラムをアンマウントするまでの待機時間。短いほどメモリ節約 */
      readonly "columnUnloadDelay": string
      /** カラムスナップショットに保存するノート数。多いほど復帰が完全 */
      readonly "snapshotMaxNotes": string
      /** カラムスナップショットの保持期間。期限切れで再フェッチ */
      readonly "snapshotTTL": string
      /** この回数/秒を超えるジャンクで自動品質ダウングレード。低いほど敏感 */
      readonly "jankDowngradeThreshold": string
      /** 安定がこの秒数続くと自動品質アップグレードを試行 */
      readonly "stableUpgradeSeconds": string
      /** 新着ノートのスライドインアニメーション時間。0 で即時表示 */
      readonly "noteAnimationDuration": string
      /** P95 フレーム時間計算用のリングバッファサイズ。大きいほど安定するが反応が遅い */
      readonly "frameHistorySize": string
      /** 通知音の AudioBuffer キャッシュ数。多サーバー利用時は増やす */
      readonly "soundCacheMax": string
      /** カラム復帰時に DB キャッシュから読み込むノート件数 */
      readonly "cachedTimelineLimit": string
      /** プルトゥリフレッシュが発火するまでの引っ張り距離 */
      readonly "pullFireThreshold": string
      /** タブ切り替えに必要な最小スワイプ距離 */
      readonly "swipeThreshold": string
      /** この速度以上のフリックで即座にタブ切り替え */
      readonly "flingVelocity": string
      /** マウスホイールによるタブ切り替え後の再発火防止時間 */
      readonly "wheelCooldown": string
      /** スクロールでナビバーを非表示にする累積距離。小さいほど敏感 */
      readonly "scrollHideThreshold": string
    }
  }
  readonly "_achievementLabels": {
    /** はじめてのノート */
    readonly "notes1": string
    /** 10 ノート */
    readonly "notes10": string
    /** 100 ノート */
    readonly "notes100": string
    /** 500 ノート */
    readonly "notes500": string
    /** 1,000 ノート */
    readonly "notes1000": string
    /** 5,000 ノート */
    readonly "notes5000": string
    /** 10,000 ノート */
    readonly "notes10000": string
    /** 20,000 ノート */
    readonly "notes20000": string
    /** 30,000 ノート */
    readonly "notes30000": string
    /** 40,000 ノート */
    readonly "notes40000": string
    /** 50,000 ノート */
    readonly "notes50000": string
    /** 60,000 ノート */
    readonly "notes60000": string
    /** 70,000 ノート */
    readonly "notes70000": string
    /** 80,000 ノート */
    readonly "notes80000": string
    /** 90,000 ノート */
    readonly "notes90000": string
    /** 100,000 ノート */
    readonly "notes100000": string
    /** ログイン 3 日 */
    readonly "login3": string
    /** ログイン 7 日 */
    readonly "login7": string
    /** ログイン 15 日 */
    readonly "login15": string
    /** ログイン 30 日 */
    readonly "login30": string
    /** ログイン 60 日 */
    readonly "login60": string
    /** ログイン 100 日 */
    readonly "login100": string
    /** ログイン 200 日 */
    readonly "login200": string
    /** ログイン 300 日 */
    readonly "login300": string
    /** ログイン 400 日 */
    readonly "login400": string
    /** ログイン 500 日 */
    readonly "login500": string
    /** ログイン 600 日 */
    readonly "login600": string
    /** ログイン 700 日 */
    readonly "login700": string
    /** ログイン 800 日 */
    readonly "login800": string
    /** ログイン 900 日 */
    readonly "login900": string
    /** ログイン 1,000 日 */
    readonly "login1000": string
    /** アカウント作成から 1 年 */
    readonly "passedSinceAccountCreated1": string
    /** アカウント作成から 2 年 */
    readonly "passedSinceAccountCreated2": string
    /** アカウント作成から 3 年 */
    readonly "passedSinceAccountCreated3": string
    /** 誕生日にログイン */
    readonly "loggedInOnBirthday": string
    /** 元日にログイン */
    readonly "loggedInOnNewYearsDay": string
    /** はじめてのクリップ */
    readonly "noteClipped1": string
    /** はじめてのお気に入り */
    readonly "noteFavorited1": string
    /** お気に入りされた */
    readonly "myNoteFavorited1": string
    /** プロフィール設定 */
    readonly "profileFilled": string
    /** Cat */
    readonly "markedAsCat": string
    /** はじめてのフォロー */
    readonly "following1": string
    /** 10 フォロー */
    readonly "following10": string
    /** 50 フォロー */
    readonly "following50": string
    /** 100 フォロー */
    readonly "following100": string
    /** 300 フォロー */
    readonly "following300": string
    /** はじめてのフォロワー */
    readonly "followers1": string
    /** 10 フォロワー */
    readonly "followers10": string
    /** 50 フォロワー */
    readonly "followers50": string
    /** 100 フォロワー */
    readonly "followers100": string
    /** 300 フォロワー */
    readonly "followers300": string
    /** 500 フォロワー */
    readonly "followers500": string
    /** 1,000 フォロワー */
    readonly "followers1000": string
    /** 実績コレクター */
    readonly "collectAchievements30": string
    /** 実績を眺める */
    readonly "viewAchievements3min": string
    /** I Love Misskey */
    readonly "iLoveMisskey": string
    /** 隠された宝物 */
    readonly "foundTreasure": string
    /** 30 分利用 */
    readonly "client30min": string
    /** 60 分利用 */
    readonly "client60min": string
    /** 1 分以内に削除 */
    readonly "noteDeletedWithin1min": string
    /** 深夜の投稿 */
    readonly "postedAtLateNight": string
    /** ジャスト 0 分 0 秒 */
    readonly "postedAt0min0sec": string
    /** セルフ引用 */
    readonly "selfQuote": string
    /** TL が速い */
    readonly "htl20npm": string
    /** インスタンスチャートを見る */
    readonly "viewInstanceChart": string
    /** Hello, World! */
    readonly "outputHelloWorldOnScratchpad": string
    /** 3 つのウィンドウ */
    readonly "open3windows": string
    /** 循環参照 */
    readonly "driveFolderCircularReference": string
    /** 読まずにリアクション */
    readonly "reactWithoutRead": string
    /** ここをクリック */
    readonly "clickedClickHere": string
    /** ただの幸運 */
    readonly "justPlainLucky": string
    /** しゅいろの名前 */
    readonly "setNameToSyuilo": string
    /** クッキークリック */
    readonly "cookieClicked": string
    /** Brain Diver */
    readonly "brainDiver": string
    /** 通知テスト連打 */
    readonly "smashTestNotificationButton": string
    /** チュートリアル完了 */
    readonly "tutorialCompleted": string
    /** バブルゲーム */
    readonly "bubbleGameExplodingHead": string
    /** バブルゲーム (ダブル) */
    readonly "bubbleGameDoubleExplodingHead": string
  }
  readonly "_labels": {
    readonly "presets": {
      /** 読取のみ (デフォルト) */
      readonly "readonly": string
      /** 安全 (リアクション可) */
      readonly "safe": string
      /** フル (全許可) */
      readonly "full": string
      /** カスタム */
      readonly "custom": string
    }
    readonly "permissions": {
      /** ノートの読取 */
      readonly "notesRead": string
      /** 手元の索引の検索 (非公開ノートを含む) */
      readonly "notesReadArchive": string
      /** ノートの投稿/編集/削除 */
      readonly "notesWrite": string
      /** リアクション/お気に入り */
      readonly "notesReact": string
      /** アカウント情報の読取 */
      readonly "accountRead": string
      /** フォロー/ブロック/ミュート */
      readonly "accountWrite": string
      /** 別アカウントとしての実行 (クロスアカウント) */
      readonly "accountActAs": string
      /** ドライブの読取 */
      readonly "driveRead": string
      /** ドライブの書込/削除 */
      readonly "driveWrite": string
      /** ローカルメモの読取/検索 */
      readonly "memosRead": string
      /** ローカルメモの作成/編集/削除 */
      readonly "memosWrite": string
      /** クリップの読取 */
      readonly "clipsRead": string
      /** クリップの作成/ノート追加・削除 */
      readonly "clipsWrite": string
      /** 下書きの読取 */
      readonly "draftsRead": string
      /** 下書きの作成/編集/削除 */
      readonly "draftsWrite": string
      /** 外部ネットワークアクセス */
      readonly "networkExternal": string
      /** ファイルのローカル保存 (ダウンロード) */
      readonly "filesExport": string
      /** バックアップの作成 */
      readonly "backupCreate": string
      /** クリップボード */
      readonly "clipboard": string
      /** デスクトップ通知 */
      readonly "notifications": string
      /** ユーザー定義タスクの実行 */
      readonly "tasksRun": string
      /** AI 呼び出し (プラグイン / 外部経路から) */
      readonly "aiInvoke": string
      /** AI persona の切り替え */
      readonly "aiPersonaWrite": string
      /** スキルの読取 */
      readonly "skillsRead": string
      /** スキルの追記/編集 */
      readonly "skillsWrite": string
      /** テーマの作成/編集 */
      readonly "themeWrite": string
      /** カスタム CSS の編集 */
      readonly "stylesWrite": string
      /** ナビバー構成の編集 */
      readonly "navbarWrite": string
      /** キーバインドの編集 */
      readonly "keybindsWrite": string
      /** パフォーマンス設定の編集 */
      readonly "performanceWrite": string
      /** ウィジェットの読取 */
      readonly "widgetsRead": string
      /** ウィジェットの作成/編集 (AiScript) */
      readonly "widgetsWrite": string
      /** プラグインの読取 */
      readonly "pluginsRead": string
      /** クエリの編集履歴の読取 */
      readonly "queriesRead": string
      /** クエリを編集履歴から復元 */
      readonly "queriesWrite": string
      /** プラグインの作成/編集 (AiScript) — AI 直接呼出しは不可 */
      readonly "pluginsWrite": string
      /** AI セッション履歴の読取 */
      readonly "aiSessionsRead": string
      /** アプリログの読取 (warn/error) */
      readonly "logsRead": string
      /** 外部サービス接続の利用 (Secret Vault) */
      readonly "vaultUse": string
      /** デッキ構成の読取 (カラム一覧 / 検索クエリ等) */
      readonly "deckRead": string
      /** デッキ構成の変更 (カラム / ウィンドウ / サイドバー / テーマ適用) */
      readonly "deckWrite": string
    }
    readonly "categories": {
      /** Misskey (サーバー側) */
      readonly "misskey": string
      /** ローカルデータ */
      readonly "local": string
      /** UI / アプリ */
      readonly "uiApp": string
    }
    /** 標準 — Misskey read のみ */
    readonly "standardExternal": string
    /** 標準 — 安全 + 外部ネットワーク */
    readonly "standardPlugin": string
    /** カスタム — 許可 {granted} / {total} */
    readonly "customGranted": ParameterizedString<'granted' | 'total'>
  }
  readonly "_pluginDenials": {
    /** 、 */
    readonly "separator": string
    /** プラグイン */
    readonly "defaultName": string
    /** 「{name}」: 権限「{permissions}」が未許可です */
    readonly "denied": ParameterizedString<'name' | 'permissions'>
  }
  readonly "_principal": {
    /** ウィジェット「{name}」 */
    readonly "widget": ParameterizedString<'name'>
    /** Play「{name}」 */
    readonly "play": ParameterizedString<'name'>
    /** ページ「{name}」 */
    readonly "page": ParameterizedString<'name'>
    /** プラグイン「{name}」 */
    readonly "plugin": ParameterizedString<'name'>
    /** 外部アプリ */
    readonly "externalApp": string
  }
  readonly "_store": {
    /** 権限設定を読み込めなかったため、安全のため最小権限で起動しました。設定から権限を確認してください。 */
    readonly "loadFailedMinimal": string
    /** 権限の保存に失敗しました。変更は反映されていません。 */
    readonly "saveFailed": string
  }
  readonly "_widgetCapabilities": {
    /** 要アップデート */
    readonly "needsUpdate": string
    /** 未対応の機能: {capability} (NoteDeck のアップデートが必要です) */
    readonly "unsupported": ParameterizedString<'capability'>
    /** 要アカウント */
    readonly "needsAccount": string
    /** アカウントが必要です (カラムにアカウントを設定してください) */
    readonly "accountRequired": string
    /** 要ログイン */
    readonly "needsLogin": string
    /** ログイン済みアカウントが必要です */
    readonly "loginRequired": string
  }
  readonly "_columnEmptyState": {
    /** サーバーに接続できません。ネットワークを確認してください。 */
    readonly "networkError": string
    /** 読み込みに失敗しました ({code}) */
    readonly "loadFailed": ParameterizedString<'code'>
    /** 情報 */
    readonly "defaultSubject": string
  }
  readonly "_readMarkerDivider": {
    /** ここまで読みました */
    readonly "readUpToHere": string
  }
  readonly "_aiConfirmRequests": {
    /** {count} 件の操作の許可を求めています */
    readonly "bundleTitle_plural": PluralString<'count'>
    /** すべて実行 */
    readonly "runAll": string
    /** 今後これらの操作を確認しない */
    readonly "rememberAll": string
  }
  readonly "_postFormConstants": {
    /** パブリック */
    readonly "public": string
    /** ダイレクト */
    readonly "specified": string
  }
  readonly "_useAccountActions": {
    /** アカウント削除に失敗しました: {error} */
    readonly "deleteAccountFailed": ParameterizedString<'error'>
    /** Vault 接続の削除に失敗しました: {error} */
    readonly "deleteVaultFailed": ParameterizedString<'error'>
    /** ゲストを削除 */
    readonly "deleteGuestTitle": string
    /** このゲストアカウントを削除しますか？ */
    readonly "confirmDeleteGuest": string
    /** {account} からログアウトしますか？
ローカルデータはこのデバイスに残ります。 */
    readonly "confirmLogout": ParameterizedString<'account'>
    /** {account} のローカルデータをすべて削除しますか？ */
    readonly "confirmDeleteData": ParameterizedString<'account'>
  }
  readonly "_useAccountPicker": {
    /** アカウントを選択 */
    readonly "title": string
  }
  readonly "_useColumnQuery": {
    /** 参照している名前付きクエリ ({id}) が見つかりません */
    readonly "missingNamedQuery": ParameterizedString<'id'>
  }
  readonly "_useColumnSetup": {
    /** このアカウントでは操作できません (未ログイン) */
    readonly "notLoggedIn": string
    /** サーバーに接続できません ({code}) */
    readonly "connectFailed": ParameterizedString<'code'>
    /** リアクションに失敗しました ({code}) */
    readonly "reactionFailed": ParameterizedString<'code'>
    /** 投票に失敗しました ({code}) */
    readonly "voteFailed": ParameterizedString<'code'>
    /** リノートに失敗しました ({code}) */
    readonly "renoteFailed": ParameterizedString<'code'>
    /** 削除に失敗しました ({code}) */
    readonly "deleteFailed": ParameterizedString<'code'>
    /** お気に入り解除 */
    readonly "unfavoriteTitle": string
    /** このノートは既にお気に入りに追加されています。お気に入りを解除しますか？ */
    readonly "confirmUnfavorite": string
    /** お気に入り解除に失敗しました ({code}) */
    readonly "unfavoriteFailed": ParameterizedString<'code'>
    /** お気に入りへの追加に失敗しました ({code}) */
    readonly "favoriteFailed": ParameterizedString<'code'>
  }
  readonly "_useCrossAccountNoteActions": {
    /** このアカウントでは操作できません (未ログイン) */
    readonly "notLoggedIn": string
    /** {account} のサーバーからこのノートを見つけられませんでした */
    readonly "noteNotFound": ParameterizedString<'account'>
    /** ノートの解決に失敗しました。あとで再試行してください */
    readonly "resolveFailed": string
    /** {account} でリアクションしました */
    readonly "reacted": ParameterizedString<'account'>
    /** リアクション解除 */
    readonly "unreactTitle": string
    /** {account} は既にこのノートにリアクションしています。リアクションを解除しますか？ */
    readonly "confirmUnreact": ParameterizedString<'account'>
    /** {account} のリアクションを解除しました */
    readonly "unreacted": ParameterizedString<'account'>
    /** リアクションの解除に失敗しました ({code}) */
    readonly "unreactFailed": ParameterizedString<'code'>
    /** リアクションに失敗しました ({code}) */
    readonly "reactionFailed": ParameterizedString<'code'>
    /** {account} でリノートしました */
    readonly "renoted": ParameterizedString<'account'>
    /** リノートに失敗しました ({code}) */
    readonly "renoteFailed": ParameterizedString<'code'>
  }
  readonly "_useCrossAccountNotes": {
    /** 新着が多すぎるため一部をスキップしました */
    readonly "overflowSkipped": string
  }
  readonly "_useDriveActions": {
    /** フォルダ作成の回数制限に達しました。しばらく待ってからやり直してください */
    readonly "rateLimitExceeded": string
    /** フォルダが空ではないため削除できません */
    readonly "folderNotEmpty": string
    /** 使用できないファイル名です */
    readonly "invalidFileName": string
    /** フォルダ名 */
    readonly "folderNamePlaceholder": string
    /** フォルダ名を変更 */
    readonly "renameFolder": string
    /** フォルダを削除 */
    readonly "deleteFolderTitle": string
    /** フォルダ「{name}」を削除しますか？ */
    readonly "confirmDeleteFolder": ParameterizedString<'name'>
    /** ファイル名を変更 */
    readonly "renameFile": string
    /** ファイルを削除 */
    readonly "deleteFileTitle": string
    /** 「{name}」をドライブから削除しますか？このファイルを添付したノートからも消えます。この操作は取り消せません。 */
    readonly "confirmDeleteFile": ParameterizedString<'name'>
  }
  readonly "_useEmojiMute": {
    /** 絵文字ミュートを解除 */
    readonly "unmuteTitle": string
    /** {emoji} のミュートを解除しますか？ */
    readonly "confirmUnmute": ParameterizedString<'emoji'>
    /** 絵文字をミュート */
    readonly "muteTitle": string
    /** {emoji} をミュートしますか？本文とリアクションでプレースホルダー表示になります。 */
    readonly "confirmMute": ParameterizedString<'emoji'>
  }
  readonly "_useEntityCrud": {
    /** クリップ */
    readonly "clip": string
    /** リスト */
    readonly "list": string
    /** アンテナ */
    readonly "antenna": string
    /** {label}名を変更 */
    readonly "renameTitle": ParameterizedString<'label'>
    /** {label}名を変更しました */
    readonly "renamed": ParameterizedString<'label'>
    /** {label}名の変更に失敗しました ({code}) */
    readonly "renameFailed": ParameterizedString<'code' | 'label'>
    /** この{label}をサーバーから削除しますか？この操作は取り消せません。 */
    readonly "confirmDelete": ParameterizedString<'label'>
    /** {label}を削除しました */
    readonly "deleted": ParameterizedString<'label'>
    /** {label}の削除に失敗しました ({code}) */
    readonly "deleteFailed": ParameterizedString<'code' | 'label'>
  }
  readonly "_useLoginPrompt": {
    /** 再ログインすると操作できます */
    readonly "reloginToContinue": string
    /** ログインの有効期限が切れました */
    readonly "sessionExpired": string
    /** ログインの有効期限が切れました。アカウントメニューから再ログインしてください。 */
    readonly "sessionExpiredUseMenu": string
  }
  readonly "_useMfmInsert": {
    /** Flip (横) */
    readonly "flipHorizontal": string
    /** Flip (縦) */
    readonly "flipVertical": string
  }
  readonly "_useNoteColumn": {
    /** 新着が多すぎるため一部をスキップしました */
    readonly "overflowSkipped": string
  }
  readonly "_useNoteFocus": {
    /** このノートを削除しますか？ */
    readonly "confirmDelete": string
    /** リンクをコピーしました */
    readonly "linkCopied": string
    /** 内容をコピーしました */
    readonly "contentCopied": string
  }
  readonly "_useOsWindowTitle": {
    /** {first} 他 {count} — NoteDeck */
    readonly "withOthers": ParameterizedString<'count' | 'first'>
  }
  readonly "_usePostFormState": {
    /** この投稿は迷惑になる可能性があります */
    readonly "annoyingTitle": string
    /** テキストの拡大や位置指定の MFM が含まれています。 */
    readonly "annoyingMessage": string
    /** ホームに投稿 */
    readonly "postToHome": string
    /** このまま投稿 */
    readonly "postAnyway": string
    /** 下書き保存にも失敗しました: {error} */
    readonly "draftSaveFailed": ParameterizedString<'error'>
  }
  readonly "_useServerPreview": {
    /** {name} は未対応です */
    readonly "unsupportedSoftware": ParameterizedString<'name'>
    /** Misskey サーバーではないため未対応です */
    readonly "notMisskey": string
    /** サーバーが見つかりません */
    readonly "notFound": string
  }
  readonly "_useUpdater": {
    /** アップデートに失敗しました。時間をおいて再試行してください。 */
    readonly "installFailed": string
  }
  readonly "_mkFollowButton": {
    /** リクエストを取り消す */
    readonly "cancelRequest": string
    /** フォロー許可待ち */
    readonly "pending": string
    /** フォロー解除 */
    readonly "unfollow": string
    /** 相互フォロー */
    readonly "mutual": string
    /** フォロー中 */
    readonly "following": string
    /** フォロー */
    readonly "follow": string
    /** @{username} のフォローを解除しますか？ */
    readonly "confirmUnfollow": ParameterizedString<'username'>
    /** 解除 */
    readonly "unfollowOk": string
    /** 操作に失敗しました ({code}) */
    readonly "failed": ParameterizedString<'code'>
  }
  readonly "_backupCapability": {
    /** ローカル DB と設定のスナップショット */
    readonly "targetsBoth": string
    /** ローカル DB のスナップショット */
    readonly "targetsDb": string
    /** 設定のスナップショット */
    readonly "targetsSettings": string
    /** バックアップを作成 */
    readonly "confirmTitle": string
    /** {targets}を ダウンロード/notedeck/backup/ に作成します。認証情報は含まれません。 */
    readonly "confirmMessage": ParameterizedString<'targets'>
    /** 作成 */
    readonly "confirmOk": string
  }
  readonly "_draftsCapability": {
    /** 下書きを削除 */
    readonly "deleteTitle": string
    /** 下書き {draftId} を削除します。この操作は取り消せません。 */
    readonly "deleteMessage": ParameterizedString<'draftId'>
  }
  readonly "_filesCapability": {
    /** ファイル {count} 件 */
    readonly "targetsFiles_plural": PluralString<'count'>
    /** ノート {count} 件の添付 */
    readonly "targetsNotes_plural": PluralString<'count'>
    /** ファイル {files} 件とノート {notes} 件の添付 */
    readonly "targetsBoth": ParameterizedString<'files' | 'notes'>
    /** ファイルをローカルに保存 */
    readonly "confirmTitle": string
    /** {targets}を ダウンロード/notedeck/{subdir}/ に保存します。 */
    readonly "confirmMessage": ParameterizedString<'subdir' | 'targets'>
    /** {targets}を ダウンロード/notedeck/{subdir}/ に保存します。センシティブ設定のファイルは除きます。 */
    readonly "confirmMessageExcludeSensitive": ParameterizedString<'subdir' | 'targets'>
  }
  readonly "_keybindsCapability": {
    /** キーバインドを変更 */
    readonly "setTitle": string
    /** `{commandId}` の shortcut を {count} 個に変更します。keybinds.reset でデフォルトに戻せます。 */
    readonly "setMessage_plural": PluralString<'commandId' | 'count'>
    /** 変更 */
    readonly "setOk": string
    /** キーバインドをデフォルトに戻す */
    readonly "resetTitle": string
    /** `{commandId}` のカスタム shortcut を破棄し、デフォルトに戻します。 */
    readonly "resetMessage": ParameterizedString<'commandId'>
    /** 全キーバインドをデフォルトに戻す */
    readonly "resetAllTitle": string
    /** 全コマンドのカスタム shortcut を破棄し、すべてデフォルトに戻します。 */
    readonly "resetAllMessage": string
  }
  readonly "_navbarCapability": {
    /** ナビバー構成を上書き */
    readonly "setTitle": string
    /** ナビバーを {count} 項目で全置換します。現在の構成は失われます (navbar.reset でデフォルトに戻せます)。 */
    readonly "setMessage_plural": PluralString<'count'>
    /** 上書き */
    readonly "setOk": string
    /** ナビバー構成をデフォルトに戻す */
    readonly "resetTitle": string
    /** 現在のカスタム構成を破棄し、デフォルトの {count} 項目に戻します。 */
    readonly "resetMessage_plural": PluralString<'count'>
  }
  readonly "_performanceCapability": {
    /** パフォーマンス値を変更 */
    readonly "setTitle": string
    /** {label} (`{key}`) を {value}{unit} に変更します。範囲外なら {min}..{max} に自動 clamp されます。 */
    readonly "setMessage": ParameterizedString<'key' | 'label' | 'max' | 'min' | 'unit' | 'value'>
    /** `{key}` を {value} に変更します。 */
    readonly "setMessageUnknown": ParameterizedString<'key' | 'value'>
    /** 変更 */
    readonly "setOk": string
    /** パフォーマンス値をデフォルトに戻す */
    readonly "resetTitle": string
    /** {label} (`{key}`) をデフォルトに戻します。 */
    readonly "resetMessage": ParameterizedString<'key' | 'label'>
    /** `{key}` をデフォルトに戻します。 */
    readonly "resetMessageUnknown": ParameterizedString<'key'>
    /** 全パフォーマンス値をデフォルトに戻す */
    readonly "resetAllTitle": string
    /** 全 override を破棄し、すべてデフォルトに戻します (= 設定をクリーン状態に)。 */
    readonly "resetAllMessage": string
    /** 省電力寄り */
    readonly "presetPowerSaving": string
    /** リッチ寄り */
    readonly "presetRich": string
    /** バランス */
    readonly "presetBalanced": string
    /** パフォーマンスプリセットを適用 */
    readonly "applyTitle": string
    /** スライダー位置 t={t} ({label}) のプリセットを全 key に適用します。 */
    readonly "applyMessage": ParameterizedString<'label' | 't'>
    /** 適用 */
    readonly "applyOk": string
  }
  readonly "_personaCapability": {
    /** AI persona を切り替え */
    readonly "title": string
    /** AI persona を「{name}」に切り替えます。chat / heartbeat / command / task すべての session に反映されます。 */
    readonly "switchMessage": ParameterizedString<'name'>
    /** 不明な skill id "{id}" を persona にしようとしています。 */
    readonly "unknownMessage": ParameterizedString<'id'>
    /** AI persona を解除します (= 通常の汎用 AI として動作)。 */
    readonly "clearMessage": string
  }
  readonly "_pluginsCapability": {
    /** プラグインをインストール */
    readonly "createTitle": string
    /** AI が生成したプラグインをインストールします。作成直後は無効化された状態なので、有効化はプラグインカラムから手動で行ってください。 */
    readonly "createMessage": string
    /** プラグインを更新 */
    readonly "updateTitle": string
    /** {name} の AiScript を {from} → {to} 文字に置換します。 */
    readonly "updateMessage": ParameterizedString<'from' | 'name' | 'to'>
    /** {name} の AiScript を {from} → {to} 文字に置換します。アクティブなため、保存後すぐ新しいコードで再起動されます。 */
    readonly "updateMessageActive": ParameterizedString<'from' | 'name' | 'to'>
  }
  readonly "_userCapability": {
    /** ノート + 通知をミュート */
    readonly "muteTitle": string
    /** userId `{userId}` を ノート + 通知ミュートします (相手に通知は飛びません)。 */
    readonly "muteMessage": ParameterizedString<'userId'>
    /** ノート + 通知を解除 */
    readonly "unmuteTitle": string
    /** userId `{userId}` を ノート + 通知解除します (相手に通知は飛びません)。 */
    readonly "unmuteMessage": ParameterizedString<'userId'>
    /** 解除 */
    readonly "unmuteOk": string
    /** リノートだけをリノートミュート */
    readonly "renoteMuteTitle": string
    /** userId `{userId}` を リノートだけリノートミュートします (相手に通知は飛びません)。 */
    readonly "renoteMuteMessage": ParameterizedString<'userId'>
    /** リノートミュート */
    readonly "renoteMuteOk": string
    /** リノートだけをリノートミュート解除 */
    readonly "unrenoteMuteTitle": string
    /** userId `{userId}` を リノートだけリノートミュート解除します (相手に通知は飛びません)。 */
    readonly "unrenoteMuteMessage": ParameterizedString<'userId'>
    /** リノートミュート解除 */
    readonly "unrenoteMuteOk": string
  }
  readonly "_vaultCapability": {
    /** 外部接続へのリクエストを許可しますか？ */
    readonly "confirmTitle": string
    /** 接続「{name}」({baseUrl}) に HTTP リクエストを送ります。 */
    readonly "confirmMessage": ParameterizedString<'baseUrl' | 'name'>
    /** 登録済みの外部サービス接続に HTTP リクエストを送ります。 */
    readonly "confirmMessageUnknown": string
    /** 許可 */
    readonly "allow": string
    /** 今後{actor}からこの接続を確認なしで使う */
    readonly "rememberForActor": ParameterizedString<'actor'>
    /** 今後この接続を確認なしで使う */
    readonly "remember": string
  }
  readonly "_widgetsCapability": {
    /** ウィジェットをインストール */
    readonly "createTitle": string
    /** AI が生成したウィジェットをインストールします。カラム表示時に自動実行されます。 */
    readonly "createMessageAutoRun": string
    /** AI が生成したウィジェットをインストールします。自動実行は無効です (= 手動で起動)。 */
    readonly "createMessageManual": string
    /** ウィジェットを更新 */
    readonly "updateTitle": string
    /** {name} の AiScript を {from} → {to} 文字に置換します。 */
    readonly "updateMessage": ParameterizedString<'from' | 'name' | 'to'>
    /** {name} の AiScript を {from} → {to} 文字に置換します。表示中のウィジェットは保存後すぐ新しいコードで再実行されます。 */
    readonly "updateMessageMounted": ParameterizedString<'from' | 'name' | 'to'>
  }
  readonly "_windowsCapability": {
    /** 全ウィンドウを閉じる */
    readonly "closeAllTitle": string
    /** 現在開いているすべての DeckWindow を閉じます。 */
    readonly "closeAllMessage": string
    /** すべて閉じる */
    readonly "closeAllOk": string
    /** キャンセル */
    readonly "cancel": string
  }
  readonly "_dispatcher": {
    /** {actor}が{label}カラムを追加しました */
    readonly "columnAdded": ParameterizedString<'actor' | 'label'>
    /** {actor}が{label}カラムをサイドバーに開きました */
    readonly "columnOpenedInSidebar": ParameterizedString<'actor' | 'label'>
    /** {actor}がカラムを削除しました */
    readonly "columnRemoved": ParameterizedString<'actor'>
    /** カラム */
    readonly "columnFallback": string
    /** {actor}が{label}カラムを移動しました */
    readonly "columnMoved": ParameterizedString<'actor' | 'label'>
    /** 設定 */
    readonly "settingsFallback": string
    /** {actor}が{label}カラムの{fields}を更新しました */
    readonly "columnSettingsUpdated": ParameterizedString<'actor' | 'fields' | 'label'>
    /** {actor}が通知を既読化しました */
    readonly "notificationsRead": ParameterizedString<'actor'>
    /** ウィンドウ */
    readonly "windowFallback": string
    /** {actor}が{label}ウィンドウを開きました */
    readonly "windowOpened": ParameterizedString<'actor' | 'label'>
    /** {actor}が{label}ウィンドウを前面に出しました */
    readonly "windowFocused": ParameterizedString<'actor' | 'label'>
    /** {actor}がウィンドウを閉じました */
    readonly "windowClosed": ParameterizedString<'actor'>
    /** {actor}が全ウィンドウを閉じました */
    readonly "allWindowsClosed": ParameterizedString<'actor'>
    /** {actor}がノートに {reaction} でリアクションしました */
    readonly "noteReactedWith": ParameterizedString<'actor' | 'reaction'>
    /** {actor}がノートにリアクションしました */
    readonly "noteReacted": ParameterizedString<'actor'>
    /** {actor}がノートのリアクションを取り消しました */
    readonly "noteUnreacted": ParameterizedString<'actor'>
    /** {actor}がノートをピン留めしました */
    readonly "notePinned": ParameterizedString<'actor'>
    /** {actor}がノートのピン留めを外しました */
    readonly "noteUnpinned": ParameterizedString<'actor'>
    /** {actor}がノートを投稿しました */
    readonly "noteCreated": ParameterizedString<'actor'>
    /** {actor}がノートを削除しました */
    readonly "noteDeleted": ParameterizedString<'actor'>
    /** {actor}がアクティブアカウントを {label} に切り替えました */
    readonly "accountSwitched": ParameterizedString<'actor' | 'label'>
    /** 実行アカウント: {account} */
    readonly "executingAccount": ParameterizedString<'account'>
    /** 今後この操作を確認しない */
    readonly "rememberOperation": string
    /** 宛先は AI が読んだ他人の内容に由来します。 */
    readonly "destinationUntrusted": string
    /** {label} を実行しますか？ */
    readonly "confirmTitle": ParameterizedString<'label'>
  }
  readonly "_cliHandlers": {
    /** 投稿するアカウント */
    readonly "pickPost": string
    /** 検索するアカウント */
    readonly "pickSearch": string
    /** タイムラインを開くアカウント */
    readonly "pickTimeline": string
    /** 通知を開くアカウント */
    readonly "pickNotifications": string
    /** メンションを開くアカウント */
    readonly "pickMentions": string
    /** お気に入りを開くアカウント */
    readonly "pickFavorites": string
    /** ノートを開くアカウント */
    readonly "pickNote": string
    /** 削除するアカウント */
    readonly "pickDelete": string
    /** 編集するアカウント */
    readonly "pickEdit": string
    /** リアクションするアカウント */
    readonly "pickReact": string
    /** リアクションを取り消すアカウント */
    readonly "pickUnreact": string
    /** リノートするアカウント */
    readonly "pickRenote": string
    /** ユーザーを開くアカウント */
    readonly "pickUser": string
    /** ユーザーのノートを開くアカウント */
    readonly "pickUserNotes": string
    /** このコマンドを実行するアカウント */
    readonly "pickCommand": string
    /** 絵文字を開くアカウント */
    readonly "pickEmojis": string
  }
  readonly "_definitions": {
    /** {mode}をオンにしました */
    readonly "modeTurnedOn": ParameterizedString<'mode'>
    /** {mode}をオフにしました */
    readonly "modeTurnedOff": ParameterizedString<'mode'>
    /** 権限がありません。write:account を付与するため再ログインしてください。 */
    readonly "permissionDenied": string
    /** アカウントを選択... */
    readonly "selectAccount": string
    /** プロフィール */
    readonly "profile": string
    /** {account} のキャッシュを削除しますか？ */
    readonly "clearAccountCacheMessage": ParameterizedString<'account'>
    /** ノートキャッシュと OGP キャッシュをすべて削除しますか？ */
    readonly "clearAllCacheMessage": string
    /** このカラムを削除しますか？ */
    readonly "closeColumnMessage": string
    /** 開発者モードを有効にしました */
    readonly "developerModeOn": string
    /** 開発者モードを無効にしました */
    readonly "developerModeOff": string
    /** プラグインを管理するアカウント */
    readonly "pickPluginsAccount": string
    /** テーマを管理するアカウント */
    readonly "pickThemesAccount": string
  }
  readonly "_quickPickProviders": {
    /** 現在のプロファイル */
    readonly "currentProfile": string
    /** 新規プロファイル作成 */
    readonly "newProfile": string
    /** プロファイルを削除 */
    readonly "deleteProfileTitle": string
    /** このプロファイルを削除しますか？ */
    readonly "deleteProfileMessage": string
    /** ログインすると利用できます */
    readonly "loginRequired": string
    /** アカウントなし */
    readonly "noAccount": string
    /** 新しい{label}を作成 */
    readonly "createNew": ParameterizedString<'label'>
    /** {label}を選択 */
    readonly "selectItem": ParameterizedString<'label'>
    /** ユーザーを選択 */
    readonly "selectUser": string
    /** ユーザーを検索... */
    readonly "searchUser": string
    /** {label}名を入力... */
    readonly "namePlaceholder": ParameterizedString<'label'>
  }
  readonly "_taskCommands": {
    /** タスク: {label} */
    readonly "label": ParameterizedString<'label'>
  }
  readonly "_accountScope": {
    /** サーバーごとに選ぶ項目のため、全アカウントでの束ね方が決まっていません */
    readonly "selectable": string
    /** サーバー単位の面のため、アカウントをまたぐ意味がありません */
    readonly "server": string
    /** このカラムはまだ全アカウントに対応していません */
    readonly "unsupported": string
  }
  readonly "_streamHealth": {
    /** {count} 時間前から */
    readonly "sinceHours_plural": PluralString<'count'>
    /** {count} 分前から */
    readonly "sinceMinutes_plural": PluralString<'count'>
    /** {count} 秒前から */
    readonly "sinceSeconds_plural": PluralString<'count'>
  }
  readonly "_connectionTemplates": {
    /** Authorization ヘッダー値 (DeepL-Auth-Key <API キー>) */
    readonly "deeplAuthHeader": string
    /** API トークン */
    readonly "apiToken": string
    /** API トークン (生の値) */
    readonly "apiTokenRaw": string
    /** API キー */
    readonly "apiKey": string
    /** API キー (mewk_...) */
    readonly "apiKeyMewk": string
  }
  readonly "_tutorialSteps": {
    /** チュートリアルが{label}の項目を示しています */
    readonly "pointingItem": ParameterizedString<'label'>
    /** チュートリアルが{name}を開きました */
    readonly "openedWindow": ParameterizedString<'name'>
    /** チュートリアルが通知カラムのボタンを示しています */
    readonly "pointingNotificationsButton": string
    /** チュートリアルが AI カラムのボタンを示しています */
    readonly "pointingAiButton": string
    /** カラムクエリ */
    readonly "columnQueryItem": string
    /** はじめに */
    readonly "gettingStartedTitle": string
    /** アカウントをつなぎ、カラムを並べて使い始める */
    readonly "gettingStartedDescription": string
    /** はじめの一歩 */
    readonly "gettingStartedAchievementName": string
    /** 使いこなす */
    readonly "masteryTitle": string
    /** 外部の AI をつないで自分の環境を動かす */
    readonly "masteryDescription": string
    /** 使い手 */
    readonly "masteryAchievementName": string
    /** 拡張をつくる */
    readonly "extendTitle": string
    /** 自分だけのプラグイン・テーマ・クエリを組み立てる */
    readonly "extendDescription": string
    /** 拡張の作者 */
    readonly "extendAchievementName": string
    /** NoteDeck へようこそ */
    readonly "welcomeTitle": string
    /** NoteDeck は Misskey を、カラムを並べたデッキとコマンドパレットで統合した環境です。基本を数ステップで案内します。途中でやめても、設定済みの内容は保たれます。 */
    readonly "welcomeDescription": string
    /** Misskey アカウントを追加 */
    readonly "accountLoginTitle": string
    /** ログインウィンドウで Misskey サーバーのホスト名 (例: misskey.io) を入れて認証してください。ログインが完了すると自動で次へ進みます。 */
    readonly "accountLoginDescription": string
    /** デッキを自分のものにする */
    readonly "customizeDeckTitle": string
    /** NoteDeck はカラムを並べて使います。最初から並んでいるのは、追加した全アカウントをまとめて表示するカラムです。カラムのヘッダーから並べ替え・削除ができ、カラム追加 (＋) から通知・検索・チャットなどを足せます。並びを 1 つ変えると自動で次へ進みます。 */
    readonly "customizeDeckDescription": string
    /** 通知をサイドバーに開く */
    readonly "openNotificationsTitle": string
    /** ナビバーの通知ボタン (光っています) を押してみましょう。ナビバーのボタンは、カラムをサイドバーに開いたり閉じたりします。開くと自動で次へ進みます。 */
    readonly "openNotificationsDescription": string
    /** プロファイルを作る */
    readonly "createProfileTitle": string
    /** カラムの並びをまるごと切り替えられます。用途ごとに作っておくと行き来が速くなります。 */
    readonly "createProfileDescription": string
    /** プラグインを作る */
    readonly "createPluginTitle": string
    /** プラグイン管理を開いて 1 つ追加してみましょう。AiScript でノートの表示やアクションに手を入れられます。 */
    readonly "createPluginDescription": string
    /** ウィジェットを作る */
    readonly "createWidgetTitle": string
    /** ウィジェットカラムを開いて 1 つ追加してみましょう。小さな AiScript を常に走らせておけます。 */
    readonly "createWidgetDescription": string
    /** テーマを作る */
    readonly "createThemeTitle": string
    /** テーマ管理を開いて 1 つ作ってみましょう。配色は変数の集まりで定義します。 */
    readonly "createThemeDescription": string
    /** カラムクエリを作る */
    readonly "createQueryTitle": string
    /** カラムクエリを開いて 1 つ作ってみましょう。AiScript で自分だけのタイムラインを組み立てられます。 */
    readonly "createQueryDescription": string
    /** スキルを作る */
    readonly "createSkillTitle": string
    /** スキル管理を開いて 1 つ作ってみましょう。AI に渡す指示をまとめておけます。 */
    readonly "createSkillDescription": string
    /** AI 接続を追加 */
    readonly "aiSetupTitle": string
    /** 接続管理ウィンドウで、Anthropic / OpenAI など AI プロバイダーの API キーを Vault に登録してください。登録すると自動で次へ進みます。 */
    readonly "aiSetupDescription": string
    /** AI プロバイダーを選択 */
    readonly "aiSelectProviderTitle": string
    /** エージェント設定を開きました。登録した接続を AI プロバイダーとして選んでください。選ぶと自動で次へ進みます。 */
    readonly "aiSelectProviderDescription": string
    /** AI カラムを開く */
    readonly "aiColumnTitle": string
    /** ナビバーの AI ボタン (光っています) から AI カラムを開いてみましょう。ここで AI と対話できます。 */
    readonly "aiColumnDescription": string
    /** セットアップ完了 */
    readonly "completeTitle": string
    /** これで NoteDeck を使い始められます。あとは自由に触ってみてください。 */
    readonly "completeDescription": string
  }
  readonly "_main": {
    /** バックエンドの初期化に失敗しました: {error} */
    readonly "backendInitFailed": ParameterizedString<'error'>
  }
  readonly "_badge": {
    /** セーフモード中はクエリを停止しています — 絞り込まずに全件表示中。押すとクエリ管理カラムを開きます */
    readonly "safeMode": string
    /** クエリを解釈できません — 押すとクエリ管理カラムを開きます */
    readonly "invalid": string
    /** 適用中のクエリはすべて無効です — 絞り込まずに全件表示中。押すとクエリ管理カラムを開きます */
    readonly "allDisabled": string
    /**  (評価エラー {count} 件を除外) */
    readonly "excludedErrors_plural": PluralString<'count'>
    /**  (無効: {names}) */
    readonly "disabledNames": ParameterizedString<'names'>
    /** クエリ適用中 — 1 件ずつ判定するため検索では使えません{errors}{disabled} — 押すとクエリ管理カラムを開きます */
    readonly "degraded": ParameterizedString<'disabled' | 'errors'>
    /** クエリ適用中{errors}{disabled} — 押すとクエリ管理カラムを開きます */
    readonly "active": ParameterizedString<'disabled' | 'errors'>
  }
  readonly "_compiler": {
    /** 式が大きすぎます (関数展開後 {max} ノード超) */
    readonly "tooLarge": ParameterizedString<'max'>
    /** 構文エラー: {error} */
    readonly "syntaxError": ParameterizedString<'error'>
    /** 式が深すぎます (深さ {max} 超) */
    readonly "tooDeep": ParameterizedString<'max'>
    /** {name} はフィルターから参照できません */
    readonly "notReferable": ParameterizedString<'name'>
    /** フィルター式が空です */
    readonly "emptyFilter": string
    /** フィルター関数の引数は (note) の 1 つだけです */
    readonly "filterFnParams": string
    /** 本体が空です */
    readonly "emptyBody": string
    /** 末尾は式である必要があります */
    readonly "lastMustBeExpr": string
    /** サブセット外の構文です: {type} */
    readonly "unsupportedSyntax": ParameterizedString<'type'>
    /** 式の結果は bool である必要があります (true = 表示) */
    readonly "resultMustBeBool": string
    /** 末尾に式がありません */
    readonly "noTrailingExpr": string
    /** var はサブセット外です (let を使ってください) */
    readonly "varUnsupported": string
    /** 型注釈はサブセット外です */
    readonly "typeAnnotationUnsupported": string
    /** 属性はサブセット外です */
    readonly "attrUnsupported": string
    /** {field} は null のことがあります。ガードしないと、そのノートが丸ごと除外されます */
    readonly "nullableField": ParameterizedString<'field'>
    /** 比較 {op} は数値専用です */
    readonly "comparisonNumericOnly": ParameterizedString<'op'>
    /** == / != はスカラー同士か null との比較のみです (配列・オブジェクトの参照等価は QIR で再現できないため) */
    readonly "eqScalarOnly": string
    /** {op} の項は bool である必要があります */
    readonly "operandMustBeBool": ParameterizedString<'op'>
    /** 未知の識別子です: {name} (フィルターから参照できるのは note と自分で定義した let/関数のみ) */
    readonly "unknownIdentifier": ParameterizedString<'name'>
    /** 関数 {name} は呼び出しの形でのみ使えます */
    readonly "fnCallOnly": ParameterizedString<'name'>
    /** .len は配列フィールド専用です (str.len はサブセット外) */
    readonly "lenArrayOnly": string
    /** プロパティ {name} はサブセット外です */
    readonly "propertyUnsupported": ParameterizedString<'name'>
    /** note.{path} はフィールド allowlist 外です */
    readonly "fieldNotAllowed": ParameterizedString<'path'>
    /** index はリテラルキーによる note.reactions[...] のみです */
    readonly "indexReactionsOnly": string
    /** index のキーは文字列リテラルのみです */
    readonly "indexKeyStringOnly": string
    /** 未知の関数です: {name} */
    readonly "unknownFunction": ParameterizedString<'name'>
    /** この呼び出し形はサブセット外です */
    readonly "callFormUnsupported": string
    /** {name}() は引数を取りません */
    readonly "noArgs": ParameterizedString<'name'>
    /** {name}() は文字列専用です */
    readonly "stringOnlyCall": ParameterizedString<'name'>
    /** incl は引数 1 つです */
    readonly "inclOneArg": string
    /** str.incl の引数は文字列です */
    readonly "strInclArgString": string
    /** arr.incl の引数はスカラーのみです */
    readonly "arrInclArgScalar": string
    /** incl は文字列か配列専用です */
    readonly "inclStringOrArray": string
    /** {name} は 1 引数形のみサブセットです (index 引数は UTF-16 依存のため降格) */
    readonly "oneArgFormOnly": ParameterizedString<'name'>
    /** {name} は文字列専用です */
    readonly "stringOnly": ParameterizedString<'name'>
    /** {name} の引数は文字列です */
    readonly "argMustBeString": ParameterizedString<'name'>
    /** メソッド {name} はサブセット外です */
    readonly "methodUnsupported": ParameterizedString<'name'>
    /** 関数 {name} は再帰しています (再帰はサブセット外) */
    readonly "recursive": ParameterizedString<'name'>
    /** 関数 {name} の引数は {count} 個です */
    readonly "fnArgCount_plural": PluralString<'count' | 'name'>
    /** オプショナル引数・デフォルト値はサブセット外です */
    readonly "optionalParamUnsupported": string
    /** 関数本体が空です */
    readonly "emptyFnBody": string
    /** 関数本体で使えない構文です: {type} (本体は let 列 + 末尾式のみ) */
    readonly "fnBodySyntax": ParameterizedString<'type'>
    /** 分割代入はサブセット外です */
    readonly "destructuringUnsupported": string
  }
  readonly "_purity": {
    /** (構文: {type}) */
    readonly "syntaxName": ParameterizedString<'type'>
  }
  readonly "_cssPresets": {
    /** M PLUS 1 Code (日本語) */
    readonly "mPlus1Code": string
    /** MS ゴシック (システム) */
    readonly "msGothic": string
    /** {name} (システム) */
    readonly "systemFont": ParameterizedString<'name'>
    /** ダイレクト */
    readonly "visibilitySpecified": string
    /** 背景色で色分け */
    readonly "tintByVisibility": string
    /** 自分のみ隠す */
    readonly "hideSelf": string
    /** 他人のみ隠す */
    readonly "hideOthers": string
    /** すべて隠す */
    readonly "hideAll": string
  }
  readonly "_duplicateIdNotice": {
    /** 同じ ID「{id}」の設定ファイルが複数あります。{file} は読み込まれていません (ファイルは残っています — 不要なら手動で削除してください) */
    readonly "single": ParameterizedString<'file' | 'id'>
    /** 「{id}」: {files} */
    readonly "entry": ParameterizedString<'files' | 'id'>
    /** 同じ ID の設定ファイルが {count} 件あります ({detail})。これらは読み込まれていません (ファイルは残っています — 不要なら手動で削除してください) */
    readonly "multiple_plural": PluralString<'count' | 'detail'>
  }
  readonly "_editHistory": {
    /** スキル */
    readonly "skill": string
    /** プラグイン */
    readonly "plugin": string
    /** ウィジェット */
    readonly "widget": string
    /** テーマ */
    readonly "theme": string
    /** クエリ */
    readonly "query": string
    /** カスタム CSS */
    readonly "css": string
    /** 記録なし */
    readonly "unrecorded": string
    /** 自分 */
    readonly "self": string
  }
  readonly "_sidecarFileCollection": {
    /** ソースファイルが見つからないため変更できません */
    readonly "readOnlyReason": string
    /** ソースファイルが見つかりません。ソースを置き直せば次回起動で復帰します。ストア配布物はストアから再導入、不要なら削除してください */
    readonly "readOnlyHint": string
  }
  readonly "_systemAdaptation": {
    /** 従量制回線のため、画像・動画はタップで読み込む表示にしました */
    readonly "meteredDeferMedia": string
    /** 省電力モードのため、画像の先読みとアニメーション絵文字を止めました */
    readonly "lowPowerStaticEmoji": string
    /** バッテリー駆動のため、画像の先読みとアニメーション絵文字を止めました */
    readonly "batteryStaticEmoji": string
  }
  readonly "_accounts": {
    /** ゲスト */
    readonly "guest": string
  }
  readonly "_deckProfile": {
    /** 旧 AiScript Console widget を {count} 件削除しました。コードは失われています (スクラッチパッドカラムで同等の機能が使えます)。 */
    readonly "consoleWidgetsRemoved_plural": PluralString<'count'>
    /** プロファイル {n} */
    readonly "defaultName": ParameterizedString<'n'>
  }
  readonly "_misstore": {
    /** 「{name}」をストアの内容で更新します。
ストア更新日: {date} / v{version} */
    readonly "updateConfirm": ParameterizedString<'date' | 'name' | 'version'>
    /** 新しい権限: {permissions} */
    readonly "newPermissions": ParameterizedString<'permissions'>
    /** ウィジェットを更新 */
    readonly "updateWidget": string
    /** プラグインを更新 */
    readonly "updatePlugin": string
    /** スキルを更新 */
    readonly "updateSkill": string
    /** クエリを更新 */
    readonly "updateQuery": string
    /** テーマを更新 */
    readonly "updateTheme": string
  }
  readonly "_pet": {
    /** slug か petdex.dev のペット URL を入れてください */
    readonly "invalidInput": string
  }
  readonly "_postForm": {
    /** 添付 */
    readonly "attach": string
    /** 投票 */
    readonly "poll": string
    /** 閲覧注意 */
    readonly "cw": string
    /** 下書き */
    readonly "draft": string
    /** クリア */
    readonly "clear": string
  }
  readonly "_taskRunner": {
    /** {prompt}: "{value}" は選択肢に含まれません ({options}) */
    readonly "notInOptions": ParameterizedString<'options' | 'prompt' | 'value'>
    /** タスク: アカウント "{id}" が見つかりません */
    readonly "accountNotFound": ParameterizedString<'id'>
    /** タスク: 利用可能なアカウントがありません */
    readonly "noAccount": string
    /** タスク "{id}" が見つかりません */
    readonly "taskNotFound": ParameterizedString<'id'>
    /** タスク完了: {label} */
    readonly "completed": ParameterizedString<'label'>
    /** タスクに失敗しました: {label} — {error} */
    readonly "failed": ParameterizedString<'error' | 'label'>
    /** デフォルトタスクがありません。tasks.json5 で isDefault: true を設定してください。 */
    readonly "noDefaultTask": string
  }
  readonly "_theme": {
    /** 「{name}」 */
    readonly "quotedName": ParameterizedString<'name'>
    /** テーマ {names} を themes/ から取り込みました */
    readonly "adoptedDropIns": ParameterizedString<'names'>
  }
  readonly "_cacheEviction": {
    /** 検索優先 */
    readonly "searchPriority": string
    /** 永続保存。過去ノートをいつまでも全文検索できる */
    readonly "searchPriorityHint": string
    /** バランス */
    readonly "balanced": string
    /** 実質永続 (アカウントあたり 1,000,000 件で hard cap) */
    readonly "balancedHint": string
    /** ストレージ優先 */
    readonly "storagePriority": string
    /** 90 日 / 50,000 件で自動削除。ディスク使用量を抑える */
    readonly "storagePriorityHint": string
    /** カスタム */
    readonly "custom": string
    /** 上限と TTL を個別に指定する */
    readonly "customHint": string
  }
  readonly "_customTimelines": {
    /** {name}モード */
    readonly "modeLabel": ParameterizedString<'name'>
  }
  readonly "_errors": {
    /** ログインが必要です。アカウントメニューから再ログインしてください。 */
    readonly "authRequired": string
  }
  readonly "_restrictedAccess": {
    /** このサーバーは{subject}を公開していません */
    readonly "notPublic": ParameterizedString<'subject'>
    /** {subject}の閲覧権限がありません */
    readonly "noPermission": ParameterizedString<'subject'>
  }
  readonly "_scheduleFormat": {
    /** {day} {time} */
    readonly "dayAt": ParameterizedString<'day' | 'time'>
    /** 期限切れ */
    readonly "expired": string
    /** まもなく */
    readonly "soon": string
    /** あと{minutes}分 */
    readonly "inMinutes": ParameterizedString<'minutes'>
    /** {minutes}分前 */
    readonly "minutesAgo": ParameterizedString<'minutes'>
    /** あと{hours}時間 */
    readonly "inHours": ParameterizedString<'hours'>
    /** {hours}時間前 */
    readonly "hoursAgo": ParameterizedString<'hours'>
    /** あと{hours}時間{minutes}分 */
    readonly "inHoursMinutes": ParameterizedString<'hours' | 'minutes'>
    /** {hours}時間{minutes}分前 */
    readonly "hoursMinutesAgo": ParameterizedString<'hours' | 'minutes'>
    /** あと{days}日 */
    readonly "inDays": ParameterizedString<'days'>
    /** {days}日前 */
    readonly "daysAgo": ParameterizedString<'days'>
    /** 30 分後 */
    readonly "in30Minutes": string
    /** 1 時間後 */
    readonly "in1Hour": string
    /** 3 時間後 */
    readonly "in3Hours": string
    /** 明日 9:00 */
    readonly "tomorrow9": string
    /** 1 週間後 */
    readonly "in1Week": string
  }
  readonly "_native": {
    readonly "preview": {
      readonly "generic": {
        /** {label} を実行しますか？ */
        readonly "title": ParameterizedString<'label'>
        /** 実行 */
        readonly "ok": string
      }
      readonly "notesDelete": {
        /** ノートを削除 */
        readonly "title": string
        /** noteId `{noteId}` を削除します。この操作は取り消せません (リノート・引用・お気に入り・クリップなども同時に消えます)。 */
        readonly "message": ParameterizedString<'noteId'>
        /** 削除 */
        readonly "ok": string
      }
      readonly "userFollow": {
        /** フォローを送る */
        readonly "title": string
        /** userId `{userId}` にフォローリクエストを送ります (相手に「フォローされた」通知が飛びます)。鍵アカウントなら承認待ちになります。 */
        readonly "message": ParameterizedString<'userId'>
        /** フォロー */
        readonly "ok": string
      }
      readonly "userUnfollow": {
        /** フォローを解除 */
        readonly "title": string
        /** userId `{userId}` のフォローを解除します (相手に「フォロワー減少」の通知は飛びません)。 */
        readonly "message": ParameterizedString<'userId'>
        /** フォロー解除 */
        readonly "ok": string
      }
      readonly "markRead": {
        /** 通知をすべて既読にする */
        readonly "title": string
        /** ログイン中の全アカウントの通知をすべて既読にします。 */
        readonly "messageAll": string
        /** アカウント `{accountId}` の通知をすべて既読にします。 */
        readonly "messageAccount": ParameterizedString<'accountId'>
        /** 既読にする */
        readonly "ok": string
      }
      readonly "registrySet": {
        /** registry に書き込み */
        readonly "title": string
        /** Misskey サーバー側の registry の `{path}` に値を書き込みます。**Misskey 公式 Web Client と共有される設定エリア**なので、公式 UI の挙動 (テーマ / 設定など) にも影響する可能性があります。 */
        readonly "message": ParameterizedString<'path'>
        /** 書き込み */
        readonly "ok": string
      }
      readonly "registryDelete": {
        /** registry の値を削除 */
        readonly "title": string
        /** Misskey サーバー側の registry の `{path}` を削除します。**Misskey 公式 Web Client と共有される設定エリア**なので、公式 UI でも該当する設定が初期化されます。 */
        readonly "message": ParameterizedString<'path'>
        /** 削除 */
        readonly "ok": string
      }
      readonly "skills": {
        readonly "create": {
          /** スキルを作成 */
          readonly "title": string
          /** AI が生成したスキル「{name}」を新規保存します。mode=always: 保存後は常に system prompt に注入されます。 */
          readonly "messageAlways": ParameterizedString<'name'>
          /** AI が生成したスキル「{name}」を新規保存します。mode=heartbeat: HEARTBEAT 有効中、tick ごとに自動実行されます。 */
          readonly "messageHeartbeat": ParameterizedString<'name'>
          /** AI が生成したスキル「{name}」を新規保存します (mode=trigger: {triggers} で自動ロード)。 */
          readonly "messageTrigger": ParameterizedString<'name' | 'triggers'>
          /** AI が生成したスキル「{name}」を新規保存します (mode=manual: 有効化するまで使われません)。 */
          readonly "messageManual": ParameterizedString<'name'>
          /** 作成 */
          readonly "ok": string
        }
        readonly "append": {
          /** スキル本文に追記 */
          readonly "title": string
          /** {name} の本文に {count} 文字を追記します。frontmatter は触れません。 */
          readonly "message_plural": PluralString<'count' | 'name'>
          /** 追記 */
          readonly "ok": string
        }
        readonly "replaceSection": {
          /** スキルのセクションを置換 */
          readonly "title": string
          /** {name} の `## {heading}` セクションを {count} 文字に置換します。該当する heading が無ければ末尾に新規追加します (idempotent)。 */
          readonly "message_plural": PluralString<'count' | 'heading' | 'name'>
          /** 置換 */
          readonly "ok": string
        }
        readonly "revert": {
          /** スキルを過去の状態に戻す */
          readonly "title": string
          /** {name} を編集履歴 #{index} ({at}) の本文に戻します。現在の body は上書きされます。 */
          readonly "message": ParameterizedString<'at' | 'index' | 'name'>
          /** この状態に戻す */
          readonly "ok": string
        }
        readonly "install": {
          /** MisStore からスキルを入れる */
          readonly "titleNew": string
          /** MisStore からスキルを更新 */
          readonly "titleUpdate": string
          /** {name} (v{version} / by {author}) を MisStore から取得します (mode={mode})。 */
          readonly "message": ParameterizedString<'author' | 'mode' | 'name' | 'version'>
          /** {name} (v{version} / by {author}) を MisStore から取得します (mode=always: 常に system prompt に注入されます)。 */
          readonly "messageAlways": ParameterizedString<'author' | 'name' | 'version'>
          /** {name} (v{version} / by {author}) を MisStore から取得します (mode={mode})。既存の「{current}」を更新します。 */
          readonly "messageUpdate": ParameterizedString<'author' | 'current' | 'mode' | 'name' | 'version'>
          /** {name} (v{version} / by {author}) を MisStore から取得します (mode=always: 常に system prompt に注入されます)。既存の「{current}」を更新します。 */
          readonly "messageUpdateAlways": ParameterizedString<'author' | 'current' | 'name' | 'version'>
          /** インストール */
          readonly "okNew": string
          /** 更新 */
          readonly "okUpdate": string
        }
        readonly "uninstall": {
          /** スキルを削除 */
          readonly "title": string
          /** {name} (v{version} / {mode} mode) を完全に削除します。frontmatter・本文・編集履歴ファイルは残りません。この操作は取り消せません。 */
          readonly "message": ParameterizedString<'mode' | 'name' | 'version'>
          /** 削除 */
          readonly "ok": string
        }
      }
      readonly "themes": {
        readonly "create": {
          /** テーマをインストール */
          readonly "title": string
          /** AI が生成したライトテーマをインストールします。 */
          readonly "messageLight": string
          /** AI が生成したダークテーマをインストールします。 */
          readonly "messageDark": string
          /** {count} 個の CSS 変数を含む {base} テーマ */
          readonly "description_plural": PluralString<'base' | 'count'>
          /** インストール */
          readonly "ok": string
        }
        readonly "update": {
          /** テーマを更新 */
          readonly "title": string
          /** {name} の {count} 個の CSS 変数を更新します。 */
          readonly "messageProps_plural": PluralString<'count' | 'name'>
          /** {name} のメタ情報を更新します。 */
          readonly "messageMeta": ParameterizedString<'name'>
          /** {base} テーマ */
          readonly "description": ParameterizedString<'base'>
          /** 更新 */
          readonly "ok": string
        }
        readonly "revert": {
          /** テーマを過去の状態に戻す */
          readonly "title": string
          /** {name} を編集履歴 #{index} ({at}) の状態に戻します。 */
          readonly "message": ParameterizedString<'at' | 'index' | 'name'>
          /** この状態に戻す */
          readonly "ok": string
        }
        readonly "install": {
          /** MisStore からテーマを入れる */
          readonly "titleNew": string
          /** MisStore からテーマを更新 */
          readonly "titleUpdate": string
          /** {name} ({base} / by {author}) を MisStore から取得してインストールします。 */
          readonly "message": ParameterizedString<'author' | 'base' | 'name'>
          /** インストール */
          readonly "okNew": string
          /** 更新 */
          readonly "okUpdate": string
        }
        readonly "uninstall": {
          /** テーマを削除 */
          readonly "title": string
          /** {name} ({base}) を完全に削除します。元に戻すには再インストールが必要です。 */
          readonly "message": ParameterizedString<'base' | 'name'>
          /** 削除 */
          readonly "ok": string
        }
        /** {base} テーマ / {count} 変数 */
        readonly "summary_plural": PluralString<'base' | 'count'>
      }
      readonly "plugins": {
        readonly "setActive": {
          /** プラグインを有効化 */
          readonly "title": string
          /** {name} を有効化します。handler が起動し、以下の permissions の操作が走り得ます。 */
          readonly "message": ParameterizedString<'name'>
          /** 有効化 */
          readonly "ok": string
        }
        readonly "delete": {
          /** プラグインを削除 */
          readonly "title": string
          /** {name} を削除します。AiScript ソース・メタ・Mk:save 領域がすべて消えます。この操作は取り消せません。 */
          readonly "message": ParameterizedString<'name'>
          /** 削除 */
          readonly "ok": string
        }
        readonly "revert": {
          /** プラグインを過去の状態に戻す */
          readonly "title": string
          /** {name} を編集履歴 #{index} ({at}) の状態に戻します。現在の AiScript ソースは上書きされます。 */
          readonly "message": ParameterizedString<'at' | 'index' | 'name'>
          /** この状態に戻す */
          readonly "ok": string
        }
        readonly "install": {
          /** MisStore からプラグインを入れる */
          readonly "titleNew": string
          /** MisStore からプラグインを更新 */
          readonly "titleUpdate": string
          /** {name} (v{version} / by {author}) を MisStore から取得します。インストール直後に自動で active=true で起動されます。 */
          readonly "message": ParameterizedString<'author' | 'name' | 'version'>
          /** {name} は既にインストール済みで内容も最新です。全体スコープへの参照だけ追加します。 */
          readonly "upToDate": ParameterizedString<'name'>
          /** インストール */
          readonly "okNew": string
          /** 更新 */
          readonly "okUpdate": string
        }
      }
      readonly "widgets": {
        readonly "delete": {
          /** ウィジェットを削除 */
          readonly "title": string
          /** {name} を削除します。AiScript ソース・メタ・Mk:save 領域がすべて消えます。この操作は取り消せません。 */
          readonly "message": ParameterizedString<'name'>
          /** {name} ほか {count} 件を削除します。AiScript ソース・メタ・Mk:save 領域がすべて消えます。この操作は取り消せません。 */
          readonly "messageMany_plural": PluralString<'count' | 'name'>
          /** 削除 */
          readonly "ok": string
        }
        readonly "revert": {
          /** ウィジェットを過去の状態に戻す */
          readonly "title": string
          /** {name} を編集履歴 #{index} ({at}) の状態に戻します。現在の AiScript ソースは上書きされます。 */
          readonly "message": ParameterizedString<'at' | 'index' | 'name'>
          /** この状態に戻す */
          readonly "ok": string
        }
        readonly "install": {
          /** MisStore からウィジェットを入れる */
          readonly "title": string
          /** ウィジェットを更新 */
          readonly "titleUpdate": string
          /** {name} (v{version} / by {author}) を MisStore から取得します。カラム表示時に自動実行されます。 */
          readonly "messageAutoRun": ParameterizedString<'author' | 'name' | 'version'>
          /** {name} (v{version} / by {author}) を MisStore から取得します。自動実行は無効です (手動で起動)。 */
          readonly "messageManual": ParameterizedString<'author' | 'name' | 'version'>
          /** {name} は既にインストール済みで内容も最新です。 */
          readonly "upToDate": ParameterizedString<'name'>
          /** インストール */
          readonly "ok": string
          /** 更新 */
          readonly "okUpdate": string
        }
      }
      readonly "misstore": {
        /** 「{name}」をストアの内容で更新します。
ストア更新日: {date} / v{version} */
        readonly "updateConfirm": ParameterizedString<'date' | 'name' | 'version'>
        /** 「{name}」をストアの内容で更新します。
ストア更新日: {date} / v{version}
新しい権限: {permissions} */
        readonly "updateConfirmWithPermissions": ParameterizedString<'date' | 'name' | 'permissions' | 'version'>
      }
      readonly "styles": {
        readonly "write": {
          /** カスタム CSS を全置換 */
          readonly "title": string
          /** custom.css の内容を {count} 文字に全置換します。現在の CSS は履歴に保存され、styles.revert で戻せます。 */
          readonly "message_plural": PluralString<'count'>
          /** 上書き */
          readonly "ok": string
        }
        readonly "append": {
          /** カスタム CSS に追記 */
          readonly "title": string
          /** custom.css の末尾に {count} 文字を追記します。既存ルールは保持されます。 */
          readonly "message_plural": PluralString<'count'>
          /** 追記 */
          readonly "ok": string
        }
        readonly "revert": {
          /** カスタム CSS を過去の状態に戻す */
          readonly "title": string
          /** custom.css を編集履歴 #{index} ({at}) の状態に戻します。現在の CSS は上書きされます (戻す操作自体も履歴に残ります)。 */
          readonly "message": ParameterizedString<'at' | 'index'>
          /** この状態に戻す */
          readonly "ok": string
        }
      }
      readonly "memos": {
        readonly "revert": {
          /** メモを過去の状態に戻す */
          readonly "title": string
          /** メモ {key} を編集履歴 #{index} ({at}) の状態に戻します。現在の本文は上書きされます。 */
          readonly "message": ParameterizedString<'at' | 'index' | 'key'>
          /** この状態に戻す */
          readonly "ok": string
        }
      }
      readonly "queries": {
        readonly "revert": {
          /** クエリを過去の状態に戻す */
          readonly "title": string
          /** {name} を編集履歴 #{index} ({at}) の状態に戻します。現在のソースは上書きされます。 */
          readonly "message": ParameterizedString<'at' | 'index' | 'name'>
          /** この状態に戻す */
          readonly "ok": string
        }
      }
      /** キャンセル */
      readonly "cancel": string
    }
    readonly "heartbeat": {
      /** HEARTBEAT を停止しました (本日の AI 起動が上限の {limit} 回に達しました) */
      readonly "stoppedDailyLimit": ParameterizedString<'limit'>
      /** HEARTBEAT: 本日の AI 起動が上限の {limit} 回を超えました (継続中) */
      readonly "overDailyLimit": ParameterizedString<'limit'>
      /** HEARTBEAT に失敗しました: {error} */
      readonly "failed": ParameterizedString<'error'>
      /** HEARTBEAT を停止しました ({count} 回連続で失敗しました) */
      readonly "stoppedFailures": ParameterizedString<'count'>
      /** {time} の HEARTBEAT */
      readonly "sessionTitle": ParameterizedString<'time'>
      /** 「{label}」の実行を提案しました */
      readonly "intentProposed": ParameterizedString<'label'>
      /** accountId が無いので下書きにできません */
      readonly "draftNeedsAccount": string
      /** ⚠ HEARTBEAT に失敗しました (source={source}): {error} */
      readonly "failedMessage": ParameterizedString<'error' | 'source'>
    }
    readonly "ai": {
      /** API キーが無効です (HTTP {status}){detail} */
      readonly "httpUnauthorized": ParameterizedString<'detail' | 'status'>
      /** API キーの権限または課金状態に問題があります (HTTP {status}){detail} — プロバイダーのコンソールで残高と API キーの権限を確認してください */
      readonly "httpForbidden": ParameterizedString<'detail' | 'status'>
      /** レート制限に達しました。少し待ってから再試行してください */
      readonly "rateLimited": string
      /** サーバーエラー (HTTP {status}){detail} */
      readonly "serverError": ParameterizedString<'detail' | 'status'>
      /** AI 接続が見つかりません */
      readonly "connectionNotFound": string
      /** 選択された接続は AI プロバイダーではありません */
      readonly "notAiProvider": string
      /** 接続「{name}」の API キーが設定されていません */
      readonly "apiKeyMissing": ParameterizedString<'name'>
      /** リクエストが大きすぎます ({size} KB / 上限 {max} KB)。長文は分割するか、不要な履歴を削除してください。 */
      readonly "requestTooLarge": ParameterizedString<'max' | 'size'>
      /** token 予算 (本日 {budget} tokens) を超えます: 使用済み {spent} + 見込み {estimate} */
      readonly "budgetExceeded": ParameterizedString<'budget' | 'estimate' | 'spent'>
      /** ターンを再開できません: {error} */
      readonly "resumeFailed": ParameterizedString<'error'>
      /** ⚠️ {error} */
      readonly "errorContent": ParameterizedString<'error'>
      /** {partial}

⚠️ {error} */
      readonly "errorContentAfter": ParameterizedString<'error' | 'partial'>
      /** {partial}

⚠️ tool 呼び出しが上限 ({max} 回) に達しました。 */
      readonly "roundLimit": ParameterizedString<'max' | 'partial'>
    }
    readonly "backup": {
      /** スキップ (既存と内容が同じ): {items} */
      readonly "skippedSame": ParameterizedString<'items'>
      /** 別名で復元 (既存と衝突): {items} → {renamed} */
      readonly "restoredRenamed": ParameterizedString<'items' | 'renamed'>
      /** スキップ (不正なファイル名): {key} */
      readonly "skippedBadFilename": ParameterizedString<'key'>
      /** スキップ (不正なキー): {key} */
      readonly "skippedBadKey": ParameterizedString<'key'>
    }
  }
  readonly "_useAiConfig": {
    /** Custom (OpenAI 互換) */
    readonly "customProviderName": string
  }
  readonly "_aiSessionTitle": {
    /** のチャット */
    readonly "chatSuffix": string
  }
  readonly "_defaultSnippets": {
    /** AiScript スニペット — VSCode の *.code-snippets と同じスキーマ */
    readonly "headerTitle": string
    /** prefix: 補完のトリガー文字列  body: 展開後のコード  description: 説明 (任意) */
    readonly "headerSchema": string
    /** {placeholder} でタブストップ、{end} で終了位置。 */
    readonly "headerTabStops": ParameterizedString<'end' | 'placeholder'>
    /** ダイアログを表示 */
    readonly "dialog": string
    /** for ループ */
    readonly "forLoop": string
    /** 配列を each で走査 */
    readonly "eachLoop": string
    /** Misskey API 呼び出し */
    readonly "apiCall": string
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
    "published": true
  }
] as const

/**
 * カラム種別の原文 (ja-JP) の表示名。以前のバージョンは既定の表示名を
 * カラムの name に保存していたので、それを「名前なし」と見分けるのに使う
 * (表示中の言語に関係なく判定するため、辞書ではなくここに持つ)
 */
export const SOURCE_COLUMN_LABELS: Readonly<Record<string, string>> = {
  "timeline": "タイムライン",
  "notifications": "通知",
  "drive": "ドライブ",
  "followRequests": "フォローリクエスト",
  "list": "リスト",
  "antenna": "アンテナ",
  "favorites": "お気に入り",
  "clip": "クリップ",
  "mentions": "メンション",
  "specified": "ダイレクト",
  "chat": "チャット",
  "achievements": "実績",
  "serverInfo": "サーバー情報",
  "aboutMisskey": "Misskey について",
  "emoji": "カスタム絵文字",
  "ads": "広告",
  "explore": "みつける",
  "announcements": "お知らせ",
  "search": "サーバー検索",
  "clientSearch": "クライアント検索",
  "lookup": "照会",
  "channel": "チャンネル",
  "role": "ロール",
  "gallery": "ギャラリー",
  "play": "Misskey Play",
  "page": "ページ",
  "user": "ユーザー",
  "charts": "チャート",
  "federation": "連合",
  "themeManager": "テーマ",
  "pluginManager": "プラグイン",
  "widget": "ウィジェット",
  "queryManager": "クエリ",
  "memos": "メモ",
  "ai": "AI",
  "skill": "スキル",
  "aiscript": "スクラッチパッド",
  "apiConsole": "API コンソール",
  "apiDocs": "API ドキュメント",
  "streamInspector": "ストリーム",
  "taskRunner": "タスク"
}

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const LOCALE_LOADERS: Record<
  LanguageCode,
  () => Promise<{ default: Locale }>
> = {
  'ja-JP': () => import('virtual:nd-locale/ja-JP'),
  'en-US': () => import('virtual:nd-locale/en-US'),
}
