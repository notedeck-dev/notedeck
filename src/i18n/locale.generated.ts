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
    /** 読込済み */
    readonly "loaded": string
    /** 本当にリセット？ */
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
    /** リフレッシュ中… */
    readonly "refreshing": string
  }
  readonly "_appConfirm": {
    /** NoteDeck の権限確認 */
    readonly "trustedHeader": string
  }
  readonly "_commandPalette": {
    /** 一致する項目がありません */
    readonly "noMatchingItems": string
    /** ↵ Enterで開く: */
    readonly "enterToOpen": string
    /** ↵ Enterで実行: */
    readonly "enterToRun": string
    /** 一致するコマンドがありません */
    readonly "noMatchingCommands": string
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
    /** ブラウザで開く */
    readonly "openInBrowser": string
  }
  readonly "_memoCard": {
    /** もっと見る */
    readonly "showMore": string
    /** ({count}文字) */
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
    /** @{username} を通報 */
    readonly "reportUser": ParameterizedString<'username'>
    /** 通報理由を入力... */
    readonly "reportReasonPlaceholder": string
    /** リアクション */
    readonly "react": string
    /** 内容をコピー */
    readonly "copyContent": string
    /** 通報 */
    readonly "report": string
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
    /** 予約を取消 */
    readonly "cancelSchedule": string
  }
  readonly "_mkDriveFolderSelectDialog": {
    /** ルート */
    readonly "root": string
    /** 新規フォルダ */
    readonly "newFolder": string
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
    /** {count}件を添付 */
    readonly "attachCount_plural": PluralString<'count'>
    /** 添付 */
    readonly "attach": string
  }
  readonly "_mkEmoji": {
    /** {emoji} (ミュート中) */
    readonly "mutedTitle": ParameterizedString<'emoji'>
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
    /** ブラウザで開く */
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
    /** ({count}文字) */
    readonly "chars_plural": PluralString<'count'>
    /** {emoji} (ミュート中) */
    readonly "mutedTitle": ParameterizedString<'emoji'>
    /** リアクションを取り消す */
    readonly "unreact": string
    /** リアクション */
    readonly "react": string
    /** リノート解除 */
    readonly "unrenote": string
    /** リノート */
    readonly "renote": string
    /** 引用 */
    readonly "quote": string
  }
  readonly "_mkNoteTree": {
    /** スレッドを続ける */
    readonly "continueThread": string
  }
  readonly "_mkPoll": {
    /** {count}票 */
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
    /** メモ */
    readonly "submitMemo": string
    /** 返信 */
    readonly "reply": string
    /** 引用 */
    readonly "quote": string
    /** 予約 */
    readonly "schedule": string
    /** ノート */
    readonly "note": string
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
    /** 予約を解除 */
    readonly "unschedule": string
    /** アカウントが選択されていません */
    readonly "noAccountSelected": string
    /** 絵文字 */
    readonly "emoji": string
    /** ファイルを添付 */
    readonly "attachFile": string
    /** 投票 */
    readonly "poll": string
    /** ハッシュタグ */
    readonly "hashtag": string
    /** メンション */
    readonly "mention": string
    /** 下書き一覧 */
    readonly "drafts": string
    /** プラグイン */
    readonly "plugins": string
    /** ボタン並び替え */
    readonly "reorderButtons": string
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
  }
  readonly "_mkReactionUsersPopup": {
    /** コードをコピー */
    readonly "copyCode": string
    /** ミュートを解除 */
    readonly "unmute": string
    /** この絵文字をミュート */
    readonly "muteEmoji": string
    /** {emoji} (ミュート中) */
    readonly "mutedTitle": ParameterizedString<'emoji'>
  }
  readonly "_mkUserListItem": {
    /** ブロック中 */
    readonly "blocking": string
    /** ミュート中 */
    readonly "muted": string
    /** フォローされています */
    readonly "followsYou": string
  }
  readonly "_mkUserPopup": {
    /** {count} ノート */
    readonly "notesCount": ParameterizedString<'count'>
    /** {count} フォロー */
    readonly "followingCount": ParameterizedString<'count'>
    /** {count} フォロワー */
    readonly "followersCount": ParameterizedString<'count'>
    /** フォローされています */
    readonly "followsYou": string
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
    /** @{username} を通報 */
    readonly "reportUser": ParameterizedString<'username'>
    /** 通報理由を入力... */
    readonly "reportReasonPlaceholder": string
    /** お気に入り解除 */
    readonly "unfavorite": string
    /** お気に入り */
    readonly "favorite": string
    /** クリップに追加 */
    readonly "addToClip": string
    /** 別のアカウントで… */
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
    /** 通報 */
    readonly "report": string
    /** このノートを操作するアカウント */
    readonly "actAsDescription": string
    /** このアカウントでは本文が非公開のため操作できません */
    readonly "contentHiddenForAccount": string
    /** リアクションを取り消す ({reaction}) */
    readonly "unreactWith": ParameterizedString<'reaction'>
    /** リアクション */
    readonly "react": string
    /** リノート */
    readonly "renote": string
    /** 引用 */
    readonly "quote": string
  }
  readonly "_noteReactionPickerPopup": {
    /** {account} として */
    readonly "actingAs": ParameterizedString<'account'>
  }
  readonly "_noteReactionUsersModal": {
    /** {emoji} (ミュート中) */
    readonly "mutedTitle": ParameterizedString<'emoji'>
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
    /** 非公開 */
    readonly "contentHidden": string
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
    /** コピー */
    readonly "copy": string
    /** データがありません */
    readonly "noData": string
  }
  readonly "_regexGuide": {
    /** フィルタ条件 */
    readonly "filterConditions": string
    /** カンマ区切りで単語を入力 */
    readonly "wordsPlaceholder": string
    /** 条件を追加 */
    readonly "addCondition": string
    /** 適用 */
    readonly "apply": string
  }
  readonly "_renoteMoreMenu": {
    /** このリノートを削除しますか？ */
    readonly "confirmDelete": string
    /** @{username} を通報 */
    readonly "reportUser": ParameterizedString<'username'>
    /** 通報理由を入力... */
    readonly "reportReasonPlaceholder": string
    /** リノートの詳細 */
    readonly "details": string
    /** リノートのリンクをコピー */
    readonly "copyLink": string
    /** リノート削除 */
    readonly "deleteRenote": string
    /** リノートを通報 */
    readonly "reportRenote": string
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
    /** リロード */
    readonly "reload": string
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
    /** OS起動時に自動起動 */
    readonly "launchAtStartup": string
    /** 表示 */
    readonly "view": string
    /** 拡大 */
    readonly "zoomIn": string
    /** 縮小 */
    readonly "zoomOut": string
    /** 再読み込み */
    readonly "reload": string
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
  }
  readonly "_mkMfm": {
    /** {emoji} (ミュート中) */
    readonly "mutedTitle": ParameterizedString<'emoji'>
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
    /** Misskey Pro — Misskey廃人のための Misskey IDE */
    readonly "tagline": string
    /** デスクトップアプリとして起動してください */
    readonly "launchAsDesktopApp": string
    /** 起動を検知すると自動で Dev Dashboard に切り替わります */
    readonly "autoSwitchHint": string
  }
  readonly "_devDashboard": {
    /** アプリ接続なし — 再接続待ち… */
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
    /** type prefix フィルタ (例: note,notification,main-) */
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
    /** capability を選択… */
    readonly "selectCapability": string
    /** 確認ダイアログあり (アプリ側に表示) */
    readonly "requiresConfirmation": string
    /** params スキーマ */
    readonly "paramsSchema": string
    /** パラメータと実行 */
    readonly "paramsAndRun": string
    /** 実行中… */
    readonly "running": string
    /** 実行 */
    readonly "run": string
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
  }
  readonly "_aiGenerationSection": {
    /** 生成 */
    readonly "title": string
    /** 既定から変更あり */
    readonly "changedFromDefault": string
    /** 既定 */
    readonly "default": string
    /** 既定のまま使える値です。実行先のモデルによって既定が合わないときだけ触ってください。 */
    readonly "note": string
    /** 応答の最大トークン */
    readonly "maxTokens": string
    /** 長い応答が途中で切れるときに上げます。0 でプロバイダーの既定に任せます (Anthropic は上限必須のため {maxTokens} を送ります) */
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
  }
  readonly "_userProfilePagesPane": {
    /** ページがありません */
    readonly "empty": string
  }
  readonly "_userProfilePlayPane": {
    /** Playがありません */
    readonly "empty": string
  }
  readonly "_userProfileHero": {
    /** フォローされています */
    readonly "followsYou": string
    /** その他 */
    readonly "more": string
    /** QRコード */
    readonly "qrCode": string
    /** フォロワーへのメッセージ */
    readonly "followedMessage": string
    /** メモ（自分のみ） */
    readonly "memoHeading": string
    /** このユーザーへのメモを追加... */
    readonly "memoPlaceholder": string
    /** ノート */
    readonly "notes": string
    /** フォロー */
    readonly "following": string
    /** フォロワー */
    readonly "followers": string
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
    /** TLに他の人への返信を含める */
    readonly "withReplies": string
    /** 投稿を通知 */
    readonly "notifyPosts": string
    /** ミュート */
    readonly "mute": string
    /** ミュート解除 */
    readonly "unmute": string
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
    /** 通報 */
    readonly "report": string
    /** @{username} をミュートしますか？ */
    readonly "muteConfirm": ParameterizedString<'username'>
    /** @{username} をブロックしますか？ */
    readonly "blockConfirm": ParameterizedString<'username'>
    /** @{username} のフォロワーを解除しますか？ */
    readonly "invalidateFollowerConfirm": ParameterizedString<'username'>
    /** 解除 */
    readonly "invalidate": string
    /** @{username} を通報 */
    readonly "reportTitle": ParameterizedString<'username'>
    /** 通報理由を入力... */
    readonly "reportPlaceholder": string
    /** リストがありません */
    readonly "noLists": string
    /** ユーザーソースのアンテナがありません */
    readonly "noUserAntennas": string
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
    /** カラムを追加 */
    readonly "addColumn": string
  }
  readonly "_aiSettingsContent": {
    /** ai.json5 を直接編集できます。API キーはキーチェーン管理のため raw には現れません。 */
    readonly "rawHint": string
    /** 無効 */
    readonly "invalid": string
  }
  readonly "_appearanceEditorContent": {
    /** 壁紙を設定 */
    readonly "setWallpaper": string
    /** 壁紙を削除 */
    readonly "removeWallpaper": string
    /** Catユーザーの語尾をにゃ化 */
    readonly "nyaize": string
    /** 本家 Web UI と同じ表示。コピー・検索は原文のまま */
    readonly "nyaizeDescription": string
    /** デフォルト値からの差分のみ表示 — 変更は自動保存されます */
    readonly "codeHint": string
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
    /** ノート・通知・フォロー情報などのローカルキャッシュDBをバックアップ / リストアします。 */
    readonly "databaseHint": string
    /** 認証情報は含まれないため、リストア後は各アカウントで再ログインしてください。 */
    readonly "databaseCredentialsNote": string
    /** バックアップ */
    readonly "backup": string
    /** リストア */
    readonly "restore": string
  }
  readonly "_clipDetailContent": {
    /** 非公開 */
    readonly "private": string
    /** クリップにノートがありません */
    readonly "empty": string
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
    /** 読み込み中… */
    readonly "loading": string
    /** 編集履歴はまだありません */
    readonly "empty": string
    /** 直前 */
    readonly "latest": string
    /** #{n} の状態に戻す */
    readonly "restore": ParameterizedString<'n'>
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
    /** フォロワー */
    readonly "followers": string
    /** フォローしているユーザーはいません */
    readonly "noFollowing": string
    /** フォロワーはいません */
    readonly "noFollowers": string
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
    /** ユーザー */
    readonly "users": string
    /** ノート */
    readonly "notes": string
    /** {endpoint} の生レスポンス */
    readonly "rawResponse": ParameterizedString<'endpoint'>
  }
  readonly "_keybindsContent": {
    /** 入力待ち... */
    readonly "recording": string
    /** ショートカットを追加 */
    readonly "addShortcut": string
    /** ユーザーカスタマイズの JSON（デフォルトからの差分のみ） */
    readonly "codeHint": string
    /** 無効 */
    readonly "invalid": string
  }
  readonly "_listDetailContent": {
    /** 非公開 */
    readonly "private": string
    /** {count} メンバー */
    readonly "members_plural": PluralString<'count'>
    /** メンバーがいません */
    readonly "noMembers": string
  }
  readonly "_memoEditorContent": {
    /** 読み込み中… */
    readonly "loading": string
    /** このメモは見つかりません */
    readonly "notFound": string
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
  }
  readonly "_noteDetailContent": {
    /** 返信はありません */
    readonly "noReplies": string
    /** リノートはありません */
    readonly "noRenotes": string
    /** {reaction} (ミュート中) */
    readonly "mutedReaction": ParameterizedString<'reaction'>
    /** リアクションはありません */
    readonly "noReactions": string
  }
  readonly "_noteInspectorContent": {
    /** ビュー */
    readonly "view": string
    /** {endpoint} の生レスポンス */
    readonly "rawResponse": ParameterizedString<'endpoint'>
    /** {endpoint} 経由で解決した ActivityPub オブジェクト */
    readonly "activityPubObject": ParameterizedString<'endpoint'>
  }
  readonly "_notificationInspectorContent": {
    /** メモリ上の通知オブジェクト */
    readonly "inMemoryObject": string
    /** {endpoint} 経由で解決した ActivityPub オブジェクト */
    readonly "activityPubObject": ParameterizedString<'endpoint'>
  }
  readonly "_pageEditContent": {
    /** タイトル */
    readonly "title": string
    /** 概要 */
    readonly "summary": string
    /** 保存中... */
    readonly "saving": string
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
    /** リロード */
    readonly "reload": string
  }
  readonly "_playEditContent": {
    /** タイトル */
    readonly "title": string
    /** 概要 */
    readonly "summary": string
    /** 保存中... */
    readonly "saving": string
  }
  readonly "_pluginsContent": {
    /** 有効 */
    readonly "enabled": string
    /** すべてデフォルトに戻す */
    readonly "resetAllToDefault": string
    /** AiScript プラグインコードを貼り付けてインストール */
    readonly "installHint": string
    /** プラグインの AiScript ソースコード — 編集後「保存して再起動」で反映 */
    readonly "codeHint": string
    /** ログはありません */
    readonly "noLogs": string
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
    /** カラムを追加 */
    readonly "addColumn": string
    /** 無効 */
    readonly "invalid": string
  }
  readonly "_snippetsEditorContent": {
    /** VSCode 互換のスニペット — prefix で補完に出ます */
    readonly "codeHint": string
    /** 無効 */
    readonly "invalid": string
    /** 本当に戻す？ */
    readonly "confirmReset": string
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
    /** {reaction} (ミュート中) */
    readonly "mutedReaction": ParameterizedString<'reaction'>
    /** リアクションはありません */
    readonly "noReactions": string
  }
  readonly "_widgetEditContent": {
    /** 自動実行: 有効 (クリックで切替) */
    readonly "autoRunOnTitle": string
    /** 自動実行: 無効 (クリックで切替) */
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
    /** 更新 */
    readonly "updateNow": string
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
  }
  readonly "_cacheEditorContent": {
    /** 使用状況 */
    readonly "usage": string
    /** ノート */
    readonly "notes": string
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
  }
  readonly "_columnQueryEditorContent": {
    /** クエリ名 */
    readonly "queryName": string
    /** 説明 (任意) */
    readonly "descriptionOptional": string
    /** AiScript 式でカラムに流すノートを定義します (true = 表示)。例: {example}。カラムへの適用はタイムラインカラムのフィルタメニューで切り替えます。 */
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
    /** クエリパラメータ */
    readonly "queryParam": string
    /** パラメータ名 (例: api_key) */
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
    /** 保存中... */
    readonly "saving": string
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
    /** コードブロック・JSON ビューア・エディタ系に反映されます */
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
    /** 追加CSS */
    readonly "freeformCss": string
    /** CSSにエラーがあるため適用されません */
    readonly "cssErrorHint": string
    /** プリセットと追加CSSを結合した全体のCSSです */
    readonly "codeHint": string
    /** プリセットに同期 */
    readonly "syncToPresets": string
    /** 無効 */
    readonly "invalid": string
    /** 履歴 */
    readonly "history": string
    /** 本当にクリア？ */
    readonly "confirmClear": string
    /** すべてクリア */
    readonly "clearAll": string
  }
  readonly "_loginContent": {
    /** 確認中... */
    readonly "checking": string
    /** サーバーに接続できます */
    readonly "serverReachable": string
    /** Misskeyサーバーに接続 */
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
    /** ブラウザで認証画面が開きました。 */
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
    /** デフォルト値からの差分のみがJSON形式で保存されます */
    readonly "codeHint": string
    /** 無効 */
    readonly "invalid": string
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
    /** コピー */
    readonly "copy": string
    /** permissions.json5 を直接編集できます。principal (ai.chat / ai.heartbeat / plugin / external) ごとの preset と custom マップを持ちます。 */
    readonly "codeHint": string
    /** 無効 */
    readonly "invalid": string
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
    /** トリガー語（1 行に 1 つ） */
    readonly "triggers": string
    /** どこ
使い方
help */
    readonly "triggersPlaceholder": string
    /** トリガー語はモードを「自動」にしたときだけ反応します */
    readonly "triggersOnlyInTriggerMode": string
    /** このスキルを AI セッションの persona 候補にする */
    readonly "personaToggle": string
    /** ON にすると、AI セッションヘッダの persona セレクタにこのスキルが表示されます。選択中のセッションで AI はこの persona として振る舞い、memo の作者として記録されます (#491)。 */
    readonly "personaHint": string
    /** ストア由来のスキル — 編集内容はローカルファイルに保存されます (再インストールで上書きされる可能性あり) */
    readonly "fromStoreNote": string
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
    /** アカウント */
    readonly "account": string
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
    /** 選択肢 (1行に1つ) */
    readonly "pickOptionsPlaceholder": string
    /** default (任意) */
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
    /**  · 保存中… */
    readonly "savingSuffix": string
    /** 無効 */
    readonly "invalid": string
    /** サンプルに戻す */
    readonly "resetToSample": string
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
    /** 実行 */
    readonly "run": string
    /** 却下 */
    readonly "dismiss": string
    /** コピー */
    readonly "copy": string
    /** 停止 */
    readonly "stop": string
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
    /** {host}（サーバー） */
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
  }
  readonly "_deckColumn": {
    /** 全アカウント */
    readonly "allAccounts": string
    /** ミュート解除 */
    readonly "unmute": string
    /** ミュート */
    readonly "mute": string
    /** ログアウト中 */
    readonly "loggedOut": string
    /** 下に引いてリフレッシュ */
    readonly "pullToRefresh": string
    /** アカウントが見つかりません */
    readonly "accountNotFound": string
    /** 最前面固定を解除 */
    readonly "unpinOnTop": string
    /** 最前面に固定 */
    readonly "pinOnTop": string
    /** デッキに戻す */
    readonly "returnToDeck": string
    /** Web UIで開く */
    readonly "openWebUi": string
    /** 分割を解除 */
    readonly "unstack": string
    /** 別ウィンドウで開く */
    readonly "popOut": string
    /** PiPウィンドウとして開く */
    readonly "openAsPip": string
    /** メインウィンドウに戻す */
    readonly "recallToMain": string
  }
  readonly "_deckDriveColumn": {
    /** ルート */
    readonly "root": string
    /** 選択 */
    readonly "select": string
    /** 新規フォルダ */
    readonly "newFolder": string
    /** アップロード */
    readonly "upload": string
    /** このフォルダの選択を解除 */
    readonly "deselectFolder": string
    /** このフォルダを全選択 */
    readonly "selectFolder": string
    /** {count} 件 */
    readonly "selectedCount_plural": PluralString<'count'>
    /** （他 {n}） */
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
    /** プロファイル */
    readonly "profile": string
    /** オンライン */
    readonly "online": string
    /** リアルタイム */
    readonly "realtime": string
    /** ノート */
    readonly "note": string
    /** アカウント */
    readonly "account": string
    /** ナビバー編集 */
    readonly "editNavbar": string
  }
  readonly "_deckNotificationColumn": {
    /** 通知はありません */
    readonly "empty": string
    /** {reaction} (ミュート中) */
    readonly "mutedReaction": ParameterizedString<'reaction'>
    /** 他{count}人 */
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
  }
  readonly "_deckServerInfoColumn": {
    /** （説明なし） */
    readonly "noDescription": string
    /** ソースコード */
    readonly "sourceCode": string
    /** 管理者 */
    readonly "maintainer": string
    /** 連絡先 */
    readonly "contact": string
    /** 問い合わせ */
    readonly "inquiry": string
    /** （なし） */
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
    /** ユーザー */
    readonly "users": string
    /** ノート */
    readonly "notes": string
    /** {endpoint} の生レスポンス */
    readonly "rawResponse": ParameterizedString<'endpoint'>
    /** サーバー情報を取得できませんでした */
    readonly "fetchFailed": string
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
    /** インストール済 */
    readonly "installedMark": string
    /** 更新 */
    readonly "update": string
    /** ストアに登録済みのスキルはありません */
    readonly "storeEmpty": string
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
    /** 履歴 */
    readonly "history": string
    /** {n} 実行中 */
    readonly "runningCount": ParameterizedString<'n'>
    /** 実行履歴はまだありません */
    readonly "noHistory": string
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
    /** 更新 */
    readonly "update": string
    /** ライブラリから削除 (本文も消えます) */
    readonly "deleteFromLibrary": string
  }
  readonly "_addColumnDialog": {
    /** {label}を選択 */
    readonly "selectItem": ParameterizedString<'label'>
    /** アカウントを選択 */
    readonly "selectAccount": string
    /** カラムを追加 */
    readonly "addColumn": string
    /** {label}を検索... */
    readonly "searchItem": ParameterizedString<'label'>
    /** {label}名を入力... */
    readonly "itemNamePlaceholder": ParameterizedString<'label'>
    /** 作成 */
    readonly "create": string
    /** 新しい{label}を作成 */
    readonly "createNew": ParameterizedString<'label'>
    /** {label}が見つかりません */
    readonly "notFound": ParameterizedString<'label'>
    /** 全アカウント */
    readonly "allAccounts": string
    /** アカウントなし */
    readonly "noAccount": string
    /** ゲストアカウントではこのカラムを使えません */
    readonly "guestUnavailable": string
  }
  readonly "_columnErrorBoundary": {
    /** カラムの表示中に問題が発生しました */
    readonly "title": string
    /** 再読み込み */
    readonly "reload": string
  }
  readonly "_columnFilterButton": {
    /** フィルター */
    readonly "filter": string
  }
  readonly "_columnPullFrame": {
    /** 下に引いてリフレッシュ */
    readonly "pullToRefresh": string
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
    /** ライトモードに切替 */
    readonly "switchToLight": string
    /** ダークモードに切替 */
    readonly "switchToDark": string
    /** ライト */
    readonly "light": string
    /** ダーク */
    readonly "dark": string
    /** デバイスのダークモードに同期 */
    readonly "syncWithDevice": string
  }
  readonly "_deckAboutMisskeyColumn": {
    /** Misskeyはオープンソースの分散型ソーシャルネットワーキングプラットフォームです。 */
    readonly "description": string
    /** もっと詳しく */
    readonly "learnMore": string
    /** ソースコード (オリジナル) */
    readonly "sourceCodeOriginal": string
    /** 翻訳 */
    readonly "translation": string
    /** 寄付 */
    readonly "donate": string
    /** このサーバーはMisskeyの改変版を使用しています。 */
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
    /** Ctrl+Enterで実行 */
    readonly "runHint": string
    /** UIコンポーネントなし */
    readonly "noUiComponents": string
  }
  readonly "_deckAnnouncementsColumn": {
    /** お知らせはありません */
    readonly "empty": string
    /** 既読にする */
    readonly "markAsRead": string
  }
  readonly "_deckAntennaColumn": {
    /** {label}を削除 */
    readonly "deleteItem": ParameterizedString<'label'>
  }
  readonly "_deckClipColumn": {
    /** {label}を削除 */
    readonly "deleteItem": ParameterizedString<'label'>
  }
  readonly "_deckListColumn": {
    /** {label}を削除 */
    readonly "deleteItem": ParameterizedString<'label'>
  }
  readonly "_deckApiConsoleColumn": {
    /** パラメータ (JSON) */
    readonly "params": string
    /** アカウントが設定されていません */
    readonly "noAccount": string
    /** ログアウト中 */
    readonly "loggedOut": string
    /** Ctrl+Enterで送信 */
    readonly "sendHint": string
  }
  readonly "_deckBottomBar": {
    /** カラムを追加 */
    readonly "addColumn": string
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
    /** 絵文字 */
    readonly "emoji": string
    /** メッセージ... */
    readonly "messagePlaceholder": string
  }
  readonly "_deckColumnsArea": {
    /** カラムがありません */
    readonly "noColumns": string
    /** 既定の構成で始める */
    readonly "startWithDefault": string
    /** カラムを追加 */
    readonly "addColumn": string
  }
  readonly "_deckEmojiColumn": {
    /** 絵文字を検索... */
    readonly "searchPlaceholder": string
    /** {count}件 */
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
    /** コードをコピー */
    readonly "copyCode": string
    /** ミュートを解除 */
    readonly "unmute": string
    /** この絵文字をミュート */
    readonly "muteEmoji": string
  }
  readonly "_deckExploreColumn": {
    /** 下に引いてリフレッシュ */
    readonly "pullToRefresh": string
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
  }
  readonly "_deckLookupColumn": {
    /** URLまたは@ユーザー名@ホスト */
    readonly "placeholder": string
    /** URLを入力して照会 */
    readonly "emptyThread": string
    /** URLまたは@ユーザー名を入力して照会 */
    readonly "emptyResult": string
  }
  readonly "_deckMemoColumn": {
    /** メモはありません */
    readonly "empty": string
    /** このメモをエディタで開く */
    readonly "openInEditor": string
    /** 投稿フォームに復元 */
    readonly "restoreToPostForm": string
  }
  readonly "_deckMentionsColumn": {
    /** 新しいノート */
    readonly "newNotes": string
  }
  readonly "_deckNoteColumn": {
    /** 新しいノート */
    readonly "newNotes": string
  }
  readonly "_deckTimelineColumn": {
    /** 新しいノート */
    readonly "newNotes": string
  }
  readonly "_deckMobileNav": {
    /** カラムを追加 */
    readonly "addColumn": string
  }
  readonly "_deckPageColumn": {
    /** ページが見つかりません */
    readonly "empty": string
  }
  readonly "_deckPlayColumn": {
    /** Playが見つかりません */
    readonly "empty": string
  }
  readonly "_deckProfileMenu": {
    /** エディタで開く */
    readonly "openInEditor": string
    /** 保存されたプロファイルはありません */
    readonly "noProfiles": string
    /** 新規プロファイル */
    readonly "newProfile": string
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
    /** Enterキーでサーバーを検索 */
    readonly "enterToSearch": string
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
  }
  readonly "_deckWindow": {
    /** Web UIで開く */
    readonly "openInWebUi": string
    /** OS の既定エディタで {name} を開く */
    readonly "openInDefaultEditor": ParameterizedString<'name'>
    /** 最小化 */
    readonly "minimize": string
    /** 最大化 */
    readonly "maximize": string
  }
  readonly "_logoutDialog": {
    /** ゲストを削除 */
    readonly "removeGuest": string
    /** ログアウト */
    readonly "logout": string
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
    /** キャッシュ削除 */
    readonly "clearCache": string
    /** ログアウト */
    readonly "logout": string
    /** データを削除 */
    readonly "deleteData": string
    /** 再ログイン */
    readonly "relogin": string
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
    /** 更新 */
    readonly "update": string
  }
  readonly "_widgetCard": {
    /** 非対応 */
    readonly "incompatible": string
    /** 更新 */
    readonly "update": string
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
    /** このアカウントから外す */
    readonly "detachFromAccount": string
    /** ライブラリから削除 (テーマも消えます) */
    readonly "deleteFromLibrary": string
    /** このアカウントに追加 */
    readonly "addToAccount": string
    /** 更新 */
    readonly "update": string
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
  }
  readonly "_widgetAiScript": {
    /** コードを編集 */
    readonly "editCode": string
    /** 実行中... */
    readonly "running": string
    /** 実行 */
    readonly "run": string
    /** ドラッグして並び替え */
    readonly "dragToReorder": string
    /** サイドバーから外す */
    readonly "removeFromSidebar": string
    /** このカラムから外す */
    readonly "removeFromColumn": string
    /** 出力 ({n}) */
    readonly "outputCount": ParameterizedString<'n'>
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

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const LOCALE_LOADERS: Record<
  LanguageCode,
  () => Promise<{ default: Locale }>
> = {
  'ja-JP': () => import('virtual:nd-locale/ja-JP'),
  'en-US': () => import('virtual:nd-locale/en-US'),
}
