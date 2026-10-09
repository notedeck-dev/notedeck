# コードマップ

<!-- このファイルは scripts/gen-codemap.mjs の生成物。手で編集せず `pnpm gen:codemap` で作り直す -->

リポジトリの構造の一覧。正本のファイルから生成していて、構造が変わると `pnpm lint:docs` が再生成を求める。設計の理由は [ARCHITECTURE.md](ARCHITECTURE.md) と [DEVELOPMENT.md](DEVELOPMENT.md) を読む。

## クレート

正本: [`Cargo.toml`](Cargo.toml) の `members`

| クレート | 場所 | 説明 (Cargo.toml の description) |
|---|---|---|
| `notedeck` | [`src-tauri`](src-tauri) | Misskey Pro — integrated deck environment (IDE) for Misskey power users |
| `notecli` | [`crates/notecli`](crates/notecli) | Headless Misskey client — CLI & library |
| `notecore` | [`crates/notecore`](crates/notecore) | NoteDeck domain core — Tauri-independent, shared by the app and notemaid |
| `notemaid` | [`crates/notemaid`](crates/notemaid) | NoteDeck の AI (メイド): エージェントループ / HEARTBEAT / capability の実行 / セッション / skill / メモ。アプリが使うライブラリと、別プロセスとして走るバイナリの 1 クレート (#1106) |

## カラム種別

正本: [`src/components/deck/columnComponents.ts`](src/components/deck/columnComponents.ts) (`BuiltinColumnType` → コンポーネント)

| 種別 | コンポーネント |
|---|---|
| `timeline` | [`src/components/deck/DeckTimelineColumn.vue`](src/components/deck/DeckTimelineColumn.vue) |
| `notifications` | [`src/components/deck/DeckNotificationColumn.vue`](src/components/deck/DeckNotificationColumn.vue) |
| `drive` | [`src/components/deck/DeckDriveColumn.vue`](src/components/deck/DeckDriveColumn.vue) |
| `followRequests` | [`src/components/deck/DeckFollowRequestsColumn.vue`](src/components/deck/DeckFollowRequestsColumn.vue) |
| `list` | [`src/components/deck/DeckListColumn.vue`](src/components/deck/DeckListColumn.vue) |
| `antenna` | [`src/components/deck/DeckAntennaColumn.vue`](src/components/deck/DeckAntennaColumn.vue) |
| `favorites` | [`src/components/deck/DeckFavoritesColumn.vue`](src/components/deck/DeckFavoritesColumn.vue) |
| `clip` | [`src/components/deck/DeckClipColumn.vue`](src/components/deck/DeckClipColumn.vue) |
| `mentions` | [`src/components/deck/DeckMentionsColumn.vue`](src/components/deck/DeckMentionsColumn.vue) |
| `specified` | [`src/components/deck/DeckMentionsColumn.vue`](src/components/deck/DeckMentionsColumn.vue) |
| `chat` | [`src/components/deck/DeckChatColumn.vue`](src/components/deck/DeckChatColumn.vue) |
| `achievements` | [`src/components/deck/DeckAchievementsColumn.vue`](src/components/deck/DeckAchievementsColumn.vue) |
| `serverInfo` | [`src/components/deck/DeckServerInfoColumn.vue`](src/components/deck/DeckServerInfoColumn.vue) |
| `aboutMisskey` | [`src/components/deck/DeckAboutMisskeyColumn.vue`](src/components/deck/DeckAboutMisskeyColumn.vue) |
| `emoji` | [`src/components/deck/DeckEmojiColumn.vue`](src/components/deck/DeckEmojiColumn.vue) |
| `ads` | [`src/components/deck/DeckAdsColumn.vue`](src/components/deck/DeckAdsColumn.vue) |
| `explore` | [`src/components/deck/DeckExploreColumn.vue`](src/components/deck/DeckExploreColumn.vue) |
| `announcements` | [`src/components/deck/DeckAnnouncementsColumn.vue`](src/components/deck/DeckAnnouncementsColumn.vue) |
| `search` | [`src/components/deck/DeckSearchColumn.vue`](src/components/deck/DeckSearchColumn.vue) |
| `clientSearch` | [`src/components/deck/DeckClientSearchColumn.vue`](src/components/deck/DeckClientSearchColumn.vue) |
| `lookup` | [`src/components/deck/DeckLookupColumn.vue`](src/components/deck/DeckLookupColumn.vue) |
| `channel` | [`src/components/deck/DeckChannelColumn.vue`](src/components/deck/DeckChannelColumn.vue) |
| `role` | [`src/components/deck/DeckRoleColumn.vue`](src/components/deck/DeckRoleColumn.vue) |
| `gallery` | [`src/components/deck/DeckGalleryColumn.vue`](src/components/deck/DeckGalleryColumn.vue) |
| `play` | [`src/components/deck/DeckPlayColumn.vue`](src/components/deck/DeckPlayColumn.vue) |
| `page` | [`src/components/deck/DeckPageColumn.vue`](src/components/deck/DeckPageColumn.vue) |
| `user` | [`src/components/deck/DeckUserColumn.vue`](src/components/deck/DeckUserColumn.vue) |
| `charts` | [`src/components/deck/DeckChartsColumn.vue`](src/components/deck/DeckChartsColumn.vue) |
| `federation` | [`src/components/deck/DeckFederationColumn.vue`](src/components/deck/DeckFederationColumn.vue) |
| `themeManager` | [`src/components/deck/DeckThemeManagerColumn.vue`](src/components/deck/DeckThemeManagerColumn.vue) |
| `pluginManager` | [`src/components/deck/DeckPluginManagerColumn.vue`](src/components/deck/DeckPluginManagerColumn.vue) |
| `widget` | [`src/components/deck/DeckWidgetColumn.vue`](src/components/deck/DeckWidgetColumn.vue) |
| `queryManager` | [`src/components/deck/DeckQueryManagerColumn.vue`](src/components/deck/DeckQueryManagerColumn.vue) |
| `memos` | [`src/components/deck/DeckMemoColumn.vue`](src/components/deck/DeckMemoColumn.vue) |
| `ai` | [`src/components/deck/DeckAiColumn.vue`](src/components/deck/DeckAiColumn.vue) |
| `skill` | [`src/components/deck/DeckSkillColumn.vue`](src/components/deck/DeckSkillColumn.vue) |
| `aiscript` | [`src/components/deck/DeckAiScriptColumn.vue`](src/components/deck/DeckAiScriptColumn.vue) |
| `apiConsole` | [`src/components/deck/DeckApiConsoleColumn.vue`](src/components/deck/DeckApiConsoleColumn.vue) |
| `apiDocs` | [`src/components/deck/DeckApiDocsColumn.vue`](src/components/deck/DeckApiDocsColumn.vue) |
| `streamInspector` | [`src/components/deck/DeckStreamInspectorColumn.vue`](src/components/deck/DeckStreamInspectorColumn.vue) |
| `taskRunner` | [`src/components/deck/DeckTaskRunnerColumn.vue`](src/components/deck/DeckTaskRunnerColumn.vue) |

## ウィンドウ種別

正本: [`src/windows/registry.ts`](src/windows/registry.ts) の `WINDOW_REGISTRY`

`note-detail` / `note-inspector` / `notification-inspector` / `user-profile` / `federation-instance` / `follow-list` / `aiSettings` / `permissions` / `plugins` / `keybinds` / `cssEditor` / `themeEditor` / `profileEditor` / `login` / `about` / `navEditor` / `performanceEditor` / `appearanceEditor` / `backup` / `cacheEditor` / `tasksEditor` / `snippetsEditor` / `memoEditor` / `column-query-editor` / `page-detail` / `play-detail` / `gallery-detail` / `list-detail` / `clip-detail` / `drive-file-detail` / `page-edit` / `play-edit` / `widget-edit` / `skill-edit` / `edit-history` / `connections` / `connectionEdit` / `tutorial` / `tutorialEditor` / `ai-turn-prompt`

## Pinia ストア

正本: [`src/stores`](src/stores) の `defineStore`

store は「購読 + キャッシュ + UI 状態」だけを持つ。純ロジックは下の service 層に置く (#782)。

| id | ファイル |
|---|---|
| `accountRegistry` | [`src/stores/accountRegistry.ts`](src/stores/accountRegistry.ts) |
| `accounts` | [`src/stores/accounts.ts`](src/stores/accounts.ts) |
| `aiSessions` | [`src/stores/aiSessions.ts`](src/stores/aiSessions.ts) |
| `aiscriptLogs` | [`src/stores/aiscriptLogs.ts`](src/stores/aiscriptLogs.ts) |
| `chatMessages` | [`src/stores/chatMessageStore.ts`](src/stores/chatMessageStore.ts) |
| `clientLayer` | [`src/stores/clientLayer.ts`](src/stores/clientLayer.ts) |
| `columnQueries` | [`src/stores/columnQueries.ts`](src/stores/columnQueries.ts) |
| `deck` | [`src/stores/deck.ts`](src/stores/deck.ts) |
| `deckProfile` | [`src/stores/deckProfile.ts`](src/stores/deckProfile.ts) |
| `deckWallpaper` | [`src/stores/deckWallpaper.ts`](src/stores/deckWallpaper.ts) |
| `emojis` | [`src/stores/emojis.ts`](src/stores/emojis.ts) |
| `keybinds` | [`src/stores/keybinds.ts`](src/stores/keybinds.ts) |
| `logs` | [`src/stores/logs.ts`](src/stores/logs.ts) |
| `misstore` | [`src/stores/misstore.ts`](src/stores/misstore.ts) |
| `mutes` | [`src/stores/mutes.ts`](src/stores/mutes.ts) |
| `notes` | [`src/stores/notes.ts`](src/stores/notes.ts) |
| `offlineMode` | [`src/stores/offlineMode.ts`](src/stores/offlineMode.ts) |
| `performance` | [`src/stores/performance.ts`](src/stores/performance.ts) |
| `pet` | [`src/stores/pet.ts`](src/stores/pet.ts) |
| `pinnedReactions` | [`src/stores/pinnedReactions.ts`](src/stores/pinnedReactions.ts) |
| `plugins` | [`src/stores/plugins.ts`](src/stores/plugins.ts) |
| `postForm` | [`src/stores/postForm.ts`](src/stores/postForm.ts) |
| `reactionRecounts` | [`src/stores/reactionRecounts.ts`](src/stores/reactionRecounts.ts) |
| `realtimeMode` | [`src/stores/realtimeMode.ts`](src/stores/realtimeMode.ts) |
| `recentEmojis` | [`src/stores/recentEmojis.ts`](src/stores/recentEmojis.ts) |
| `servers` | [`src/stores/servers.ts`](src/stores/servers.ts) |
| `settings` | [`src/stores/settings.ts`](src/stores/settings.ts) |
| `skills` | [`src/stores/skills.ts`](src/stores/skills.ts) |
| `streamInspector` | [`src/stores/streamInspector.ts`](src/stores/streamInspector.ts) |
| `streaming` | [`src/stores/streaming.ts`](src/stores/streaming.ts) |
| `suspensions` | [`src/stores/suspensions.ts`](src/stores/suspensions.ts) |
| `systemState` | [`src/stores/systemState.ts`](src/stores/systemState.ts) |
| `taskRunner` | [`src/stores/taskRunner.ts`](src/stores/taskRunner.ts) |
| `tasks` | [`src/stores/tasks.ts`](src/stores/tasks.ts) |
| `theme` | [`src/stores/theme.ts`](src/stores/theme.ts) |
| `ui` | [`src/stores/ui.ts`](src/stores/ui.ts) |
| `widgets` | [`src/stores/widgets.ts`](src/stores/widgets.ts) |
| `windows` | [`src/stores/windows.ts`](src/stores/windows.ts) |

## service 層と仕様テスト

正本: [`src/services`](src/services)

正規化・マイグレーション・マージ規則・codec などの純ロジック。隣のテストがそのまま仕様書になっている — 挙動を知りたいときはテストから読む (#782 / #895)。

| service | テスト |
|---|---|
| [`src/services/achievements.ts`](src/services/achievements.ts) | — |
| [`src/services/acpPreapproval.ts`](src/services/acpPreapproval.ts) | [`src/services/acpPreapproval.test.ts`](src/services/acpPreapproval.test.ts) |
| [`src/services/aiSessionCodec.ts`](src/services/aiSessionCodec.ts) | [`src/services/aiSessionCodec.test.ts`](src/services/aiSessionCodec.test.ts) |
| [`src/services/aiSessionId.ts`](src/services/aiSessionId.ts) | [`src/services/aiSessionId.test.ts`](src/services/aiSessionId.test.ts) |
| [`src/services/aiToolSummary.ts`](src/services/aiToolSummary.ts) | [`src/services/aiToolSummary.test.ts`](src/services/aiToolSummary.test.ts) |
| [`src/services/aiTurnIds.ts`](src/services/aiTurnIds.ts) | [`src/services/aiTurnIds.test.ts`](src/services/aiTurnIds.test.ts) |
| [`src/services/aiWorkspaceEdit.ts`](src/services/aiWorkspaceEdit.ts) | [`src/services/aiWorkspaceEdit.test.ts`](src/services/aiWorkspaceEdit.test.ts) |
| [`src/services/boundedCache.ts`](src/services/boundedCache.ts) | [`src/services/boundedCache.test.ts`](src/services/boundedCache.test.ts) |
| [`src/services/cacheEvictionConfig.ts`](src/services/cacheEvictionConfig.ts) | — |
| [`src/services/captureBudget.ts`](src/services/captureBudget.ts) | [`src/services/captureBudget.test.ts`](src/services/captureBudget.test.ts) |
| [`src/services/chatDateSeparators.ts`](src/services/chatDateSeparators.ts) | [`src/services/chatDateSeparators.test.ts`](src/services/chatDateSeparators.test.ts) |
| [`src/services/chatHistoryEntries.ts`](src/services/chatHistoryEntries.ts) | [`src/services/chatHistoryEntries.test.ts`](src/services/chatHistoryEntries.test.ts) |
| [`src/services/clientConfig.ts`](src/services/clientConfig.ts) | [`src/services/clientConfig.test.ts`](src/services/clientConfig.test.ts) |
| [`src/services/columnCacheKey.ts`](src/services/columnCacheKey.ts) | [`src/services/columnCacheKey.test.ts`](src/services/columnCacheKey.test.ts) |
| [`src/services/columnQuery/badge.ts`](src/services/columnQuery/badge.ts) | [`src/services/columnQuery/badge.test.ts`](src/services/columnQuery/badge.test.ts) |
| [`src/services/columnQuery/compiler.ts`](src/services/columnQuery/compiler.ts) | [`src/services/columnQuery/compiler.test.ts`](src/services/columnQuery/compiler.test.ts) |
| [`src/services/columnQuery/composeQir.ts`](src/services/columnQuery/composeQir.ts) | [`src/services/columnQuery/composeQir.test.ts`](src/services/columnQuery/composeQir.test.ts) |
| [`src/services/columnQuery/degradedBatch.ts`](src/services/columnQuery/degradedBatch.ts) | [`src/services/columnQuery/degradedBatch.test.ts`](src/services/columnQuery/degradedBatch.test.ts) |
| [`src/services/columnQuery/degradedRunner.ts`](src/services/columnQuery/degradedRunner.ts) | [`src/services/columnQuery/degradedRunner.test.ts`](src/services/columnQuery/degradedRunner.test.ts) |
| [`src/services/columnQuery/evaluator.ts`](src/services/columnQuery/evaluator.ts) | — |
| [`src/services/columnQuery/purity.ts`](src/services/columnQuery/purity.ts) | [`src/services/columnQuery/purity.test.ts`](src/services/columnQuery/purity.test.ts) |
| [`src/services/columnQuery/referenceEvaluator.ts`](src/services/columnQuery/referenceEvaluator.ts) | [`src/services/columnQuery/referenceEvaluator.test.ts`](src/services/columnQuery/referenceEvaluator.test.ts) |
| [`src/services/columnUri.ts`](src/services/columnUri.ts) | — |
| [`src/services/concurrency.ts`](src/services/concurrency.ts) | [`src/services/concurrency.test.ts`](src/services/concurrency.test.ts) |
| [`src/services/cssPresets.ts`](src/services/cssPresets.ts) | [`src/services/cssPresets.test.ts`](src/services/cssPresets.test.ts) |
| [`src/services/dateSeparator.ts`](src/services/dateSeparator.ts) | [`src/services/dateSeparator.test.ts`](src/services/dateSeparator.test.ts) |
| [`src/services/deckLayout.ts`](src/services/deckLayout.ts) | [`src/services/deckLayout.test.ts`](src/services/deckLayout.test.ts) |
| [`src/services/deckProfileCodec.ts`](src/services/deckProfileCodec.ts) | [`src/services/deckProfileCodec.test.ts`](src/services/deckProfileCodec.test.ts) |
| [`src/services/deckProfileFiles.ts`](src/services/deckProfileFiles.ts) | — |
| [`src/services/defaultDeck.ts`](src/services/defaultDeck.ts) | [`src/services/defaultDeck.test.ts`](src/services/defaultDeck.test.ts) |
| [`src/services/developerMode.ts`](src/services/developerMode.ts) | [`src/services/developerMode.test.ts`](src/services/developerMode.test.ts) |
| [`src/services/distributable.ts`](src/services/distributable.ts) | — |
| [`src/services/distributableCodecs/pluginCodec.ts`](src/services/distributableCodecs/pluginCodec.ts) | — |
| [`src/services/distributableCodecs/queryCodec.ts`](src/services/distributableCodecs/queryCodec.ts) | — |
| [`src/services/distributableCodecs/sidecar.ts`](src/services/distributableCodecs/sidecar.ts) | — |
| [`src/services/distributableCodecs/skillCodec.ts`](src/services/distributableCodecs/skillCodec.ts) | — |
| [`src/services/distributableCodecs/themeCodec.ts`](src/services/distributableCodecs/themeCodec.ts) | — |
| [`src/services/distributableCodecs/widgetCodec.ts`](src/services/distributableCodecs/widgetCodec.ts) | — |
| [`src/services/duplicateIdNotice.ts`](src/services/duplicateIdNotice.ts) | [`src/services/duplicateIdNotice.test.ts`](src/services/duplicateIdNotice.test.ts) |
| [`src/services/editHistory.ts`](src/services/editHistory.ts) | [`src/services/editHistory.test.ts`](src/services/editHistory.test.ts) |
| [`src/services/embedCode.ts`](src/services/embedCode.ts) | — |
| [`src/services/emojiMute.ts`](src/services/emojiMute.ts) | [`src/services/emojiMute.test.ts`](src/services/emojiMute.test.ts) |
| [`src/services/emojiSearch.ts`](src/services/emojiSearch.ts) | [`src/services/emojiSearch.test.ts`](src/services/emojiSearch.test.ts) |
| [`src/services/emojiSkinTone.ts`](src/services/emojiSkinTone.ts) | [`src/services/emojiSkinTone.test.ts`](src/services/emojiSkinTone.test.ts) |
| [`src/services/emojiWarm.ts`](src/services/emojiWarm.ts) | [`src/services/emojiWarm.dom.test.ts`](src/services/emojiWarm.dom.test.ts) |
| [`src/services/entityResolution.ts`](src/services/entityResolution.ts) | [`src/services/entityResolution.test.ts`](src/services/entityResolution.test.ts) |
| [`src/services/extractUrlFromMfm.ts`](src/services/extractUrlFromMfm.ts) | [`src/services/extractUrlFromMfm.test.ts`](src/services/extractUrlFromMfm.test.ts) |
| [`src/services/followTransition.ts`](src/services/followTransition.ts) | [`src/services/followTransition.test.ts`](src/services/followTransition.test.ts) |
| [`src/services/fuzzyMatch.ts`](src/services/fuzzyMatch.ts) | [`src/services/fuzzyMatch.test.ts`](src/services/fuzzyMatch.test.ts) |
| [`src/services/heartbeatSteps.ts`](src/services/heartbeatSteps.ts) | [`src/services/heartbeatSteps.test.ts`](src/services/heartbeatSteps.test.ts) |
| [`src/services/idFreeze.ts`](src/services/idFreeze.ts) | [`src/services/idFreeze.test.ts`](src/services/idFreeze.test.ts) |
| [`src/services/identityId.ts`](src/services/identityId.ts) | [`src/services/identityId.test.ts`](src/services/identityId.test.ts) |
| [`src/services/imageMemory.ts`](src/services/imageMemory.ts) | [`src/services/imageMemory.test.ts`](src/services/imageMemory.test.ts) |
| [`src/services/localeSetting.ts`](src/services/localeSetting.ts) | [`src/services/localeSetting.test.ts`](src/services/localeSetting.test.ts) |
| [`src/services/mapEviction.ts`](src/services/mapEviction.ts) | [`src/services/mapEviction.test.ts`](src/services/mapEviction.test.ts) |
| [`src/services/mediaTime.ts`](src/services/mediaTime.ts) | [`src/services/mediaTime.test.ts`](src/services/mediaTime.test.ts) |
| [`src/services/mfmParser.ts`](src/services/mfmParser.ts) | — |
| [`src/services/nativeContextMenu.ts`](src/services/nativeContextMenu.ts) | [`src/services/nativeContextMenu.dom.test.ts`](src/services/nativeContextMenu.dom.test.ts) |
| [`src/services/noteFrame.ts`](src/services/noteFrame.ts) | [`src/services/noteFrame.test.ts`](src/services/noteFrame.test.ts) |
| [`src/services/noteGroup.ts`](src/services/noteGroup.ts) | [`src/services/noteGroup.test.ts`](src/services/noteGroup.test.ts) |
| [`src/services/noteKey.ts`](src/services/noteKey.ts) | [`src/services/noteKey.test.ts`](src/services/noteKey.test.ts) |
| [`src/services/noteSummary.ts`](src/services/noteSummary.ts) | [`src/services/noteSummary.test.ts`](src/services/noteSummary.test.ts) |
| [`src/services/noteUrl.ts`](src/services/noteUrl.ts) | [`src/services/noteUrl.test.ts`](src/services/noteUrl.test.ts) |
| [`src/services/notificationMerge.ts`](src/services/notificationMerge.ts) | [`src/services/notificationMerge.test.ts`](src/services/notificationMerge.test.ts) |
| [`src/services/notificationNoteSync.ts`](src/services/notificationNoteSync.ts) | [`src/services/notificationNoteSync.test.ts`](src/services/notificationNoteSync.test.ts) |
| [`src/services/nyaize.ts`](src/services/nyaize.ts) | [`src/services/nyaize.test.ts`](src/services/nyaize.test.ts) |
| [`src/services/ogp.ts`](src/services/ogp.ts) | — |
| [`src/services/osGlobalShortcuts.ts`](src/services/osGlobalShortcuts.ts) | [`src/services/osGlobalShortcuts.test.ts`](src/services/osGlobalShortcuts.test.ts) |
| [`src/services/petActivity.ts`](src/services/petActivity.ts) | [`src/services/petActivity.test.ts`](src/services/petActivity.test.ts) |
| [`src/services/petSprite.ts`](src/services/petSprite.ts) | [`src/services/petSprite.test.ts`](src/services/petSprite.test.ts) |
| [`src/services/pollVote.ts`](src/services/pollVote.ts) | [`src/services/pollVote.test.ts`](src/services/pollVote.test.ts) |
| [`src/services/previewNote.ts`](src/services/previewNote.ts) | [`src/services/previewNote.test.ts`](src/services/previewNote.test.ts) |
| [`src/services/reactionKey.ts`](src/services/reactionKey.ts) | [`src/services/reactionKey.test.ts`](src/services/reactionKey.test.ts) |
| [`src/services/reactionRecount.ts`](src/services/reactionRecount.ts) | [`src/services/reactionRecount.test.ts`](src/services/reactionRecount.test.ts) |
| [`src/services/reactionToggle.ts`](src/services/reactionToggle.ts) | [`src/services/reactionToggle.test.ts`](src/services/reactionToggle.test.ts) |
| [`src/services/remoteReaction.ts`](src/services/remoteReaction.ts) | [`src/services/remoteReaction.test.ts`](src/services/remoteReaction.test.ts) |
| [`src/services/renderCache.ts`](src/services/renderCache.ts) | [`src/services/renderCache.test.ts`](src/services/renderCache.test.ts) |
| [`src/services/safeModeSources.ts`](src/services/safeModeSources.ts) | [`src/services/safeModeSources.test.ts`](src/services/safeModeSources.test.ts) |
| [`src/services/safeUrl.ts`](src/services/safeUrl.ts) | [`src/services/safeUrl.test.ts`](src/services/safeUrl.test.ts) |
| [`src/services/scheduleTime.ts`](src/services/scheduleTime.ts) | [`src/services/scheduleTime.test.ts`](src/services/scheduleTime.test.ts) |
| [`src/services/searchFilter.ts`](src/services/searchFilter.ts) | [`src/services/searchFilter.test.ts`](src/services/searchFilter.test.ts) |
| [`src/services/searchRun.ts`](src/services/searchRun.ts) | [`src/services/searchRun.test.ts`](src/services/searchRun.test.ts) |
| [`src/services/selfEditApply.ts`](src/services/selfEditApply.ts) | [`src/services/selfEditApply.test.ts`](src/services/selfEditApply.test.ts) |
| [`src/services/sessionTitle.ts`](src/services/sessionTitle.ts) | [`src/services/sessionTitle.test.ts`](src/services/sessionTitle.test.ts) |
| [`src/services/settingsFileSync.ts`](src/services/settingsFileSync.ts) | [`src/services/settingsFileSync.test.ts`](src/services/settingsFileSync.test.ts) |
| [`src/services/settingsSlug.ts`](src/services/settingsSlug.ts) | [`src/services/settingsSlug.test.ts`](src/services/settingsSlug.test.ts) |
| [`src/services/shortcutFormat.ts`](src/services/shortcutFormat.ts) | [`src/services/shortcutFormat.test.ts`](src/services/shortcutFormat.test.ts) |
| [`src/services/sidecarFileCollection.ts`](src/services/sidecarFileCollection.ts) | [`src/services/sidecarFileCollection.test.ts`](src/services/sidecarFileCollection.test.ts) |
| [`src/services/singleFileCollection.ts`](src/services/singleFileCollection.ts) | [`src/services/singleFileCollection.test.ts`](src/services/singleFileCollection.test.ts) |
| [`src/services/skillFrontmatter.ts`](src/services/skillFrontmatter.ts) | [`src/services/skillFrontmatter.test.ts`](src/services/skillFrontmatter.test.ts) |
| [`src/services/sortNotes.ts`](src/services/sortNotes.ts) | [`src/services/sortNotes.test.ts`](src/services/sortNotes.test.ts) |
| [`src/services/storeMovedPlugins.ts`](src/services/storeMovedPlugins.ts) | [`src/services/storeMovedPlugins.test.ts`](src/services/storeMovedPlugins.test.ts) |
| [`src/services/storeMovedSkills.ts`](src/services/storeMovedSkills.ts) | [`src/services/storeMovedSkills.test.ts`](src/services/storeMovedSkills.test.ts) |
| [`src/services/streamUpdateMerge.ts`](src/services/streamUpdateMerge.ts) | [`src/services/streamUpdateMerge.test.ts`](src/services/streamUpdateMerge.test.ts) |
| [`src/services/systemAdaptation.ts`](src/services/systemAdaptation.ts) | [`src/services/systemAdaptation.test.ts`](src/services/systemAdaptation.test.ts) |
| [`src/services/themeDropIn.ts`](src/services/themeDropIn.ts) | [`src/services/themeDropIn.test.ts`](src/services/themeDropIn.test.ts) |
| [`src/services/timelineFilter.ts`](src/services/timelineFilter.ts) | [`src/services/timelineFilter.test.ts`](src/services/timelineFilter.test.ts) |
| [`src/services/timelineGap.ts`](src/services/timelineGap.ts) | [`src/services/timelineGap.test.ts`](src/services/timelineGap.test.ts) |
| [`src/services/timelinePolicy.ts`](src/services/timelinePolicy.ts) | [`src/services/timelinePolicy.test.ts`](src/services/timelinePolicy.test.ts) |
| [`src/services/toggleFavorite.ts`](src/services/toggleFavorite.ts) | — |
| [`src/services/trayMenu.ts`](src/services/trayMenu.ts) | [`src/services/trayMenu.test.ts`](src/services/trayMenu.test.ts) |
| [`src/services/tutorialAchievements.ts`](src/services/tutorialAchievements.ts) | [`src/services/tutorialAchievements.test.ts`](src/services/tutorialAchievements.test.ts) |
| [`src/services/tutorialNotifications.ts`](src/services/tutorialNotifications.ts) | [`src/services/tutorialNotifications.test.ts`](src/services/tutorialNotifications.test.ts) |
| [`src/services/tutorialProgress.ts`](src/services/tutorialProgress.ts) | [`src/services/tutorialProgress.test.ts`](src/services/tutorialProgress.test.ts) |
| [`src/services/twemoji.ts`](src/services/twemoji.ts) | [`src/services/twemoji.test.ts`](src/services/twemoji.test.ts) |
| [`src/services/uiZoom.ts`](src/services/uiZoom.ts) | [`src/services/uiZoom.test.ts`](src/services/uiZoom.test.ts) |
| [`src/services/userLookupResult.ts`](src/services/userLookupResult.ts) | [`src/services/userLookupResult.test.ts`](src/services/userLookupResult.test.ts) |
| [`src/services/userRef.ts`](src/services/userRef.ts) | [`src/services/userRef.test.ts`](src/services/userRef.test.ts) |
| [`src/services/widgetInstances.ts`](src/services/widgetInstances.ts) | [`src/services/widgetInstances.test.ts`](src/services/widgetInstances.test.ts) |
| [`src/services/wordMuteMatch.ts`](src/services/wordMuteMatch.ts) | [`src/services/wordMuteMatch.test.ts`](src/services/wordMuteMatch.test.ts) |

## 設定ファイル

正本: [`crates/notecore/src/settings_store.rs`](crates/notecore/src/settings_store.rs) の `ROOT_FILES` / `ALLOWED_SUBDIRS`

`side` は「デバイスが 1 台も繋がっていなくても意味を持つか」(Core) か手元側 (Device) か。バックアップの例外 (`notemaid/` の人格と記憶、Vault の `connections.json`) は DESIGN.md の「ファイル構造」を参照。

| ルートファイル | side | バックアップ |
|---|---|---|
| `custom.css` | Device | ✓ |
| `keybinds.json5` | Device | ✓ |
| `ai.json5` | Core | ✓ |
| `AI.md` | Core | ✓ |
| `performance.json5` | Device | ✓ |
| `navbar.json5` | Device | ✓ |
| `postform.json5` | Device | ✓ |
| `settings.json5` | Core | ✓ |
| `tasks.json5` | Core | ✓ |
| `tutorial.json5` | Device | ✓ |
| `permissions.json5` | Core | ✓ |
| `custom.css.history.json5` | Device | ✓ |
| `theme-dropins.json5` | Core | ✓ |
| `locale.json5` | Device | ✓ |
| `client.json5` | Device | — |

サブディレクトリ: `profiles/` / `themes/` / `plugins/` / `snippets/` / `memos/` / `widgets/` / `skills/` / `sessions/` / `queries/`

## 生成済みの一覧 (ここには写さない)

正本: それぞれのファイル

- Tauri コマンドと型: [`src/bindings.ts`](src/bindings.ts) (tauri-specta の生成物)
- capability と権限キー: [`crates/notecore/capabilities.json5`](crates/notecore/capabilities.json5) (TS / Rust の表はここから生成)
- HTTP API: [`src-tauri/openapi.json`](src-tauri/openapi.json)
- UI 文言: [`locales/ja-JP.yml`](locales/ja-JP.yml)
