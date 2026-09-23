//! コマンド表の本体 (#1106 §4.1)。行の形は commands/mod.rs の説明を参照。
//!
//! `with_command_table!(callback)` は、この表の全行を `callback!{ ... }` に渡す。
//! notecore 自身は dispatch / CommandId を、アプリは Tauri ラッパーを、それぞれ
//! 自分のマクロで生成する。表はここ 1 つ。

#[macro_export]
macro_rules! with_command_table {
    ($cb:ident) => {
        $cb! {
            // --- timeline (crates/notecore/src/commands/timeline.rs) ---
        data api_get_timeline(account_id: String, timeline_type: String, options: Option<notecli::models::TimelineOptions>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_timeline;
        data api_get_user_lists(account_id: String) -> Vec<notecli::models::UserList> = $crate::commands::timeline::api_get_user_lists;
        data api_get_antennas(account_id: String) -> Vec<notecli::models::Antenna> = $crate::commands::timeline::api_get_antennas;
        data api_get_antenna(account_id: String, antenna_id: String) -> notecli::models::Antenna = $crate::commands::timeline::api_get_antenna;
        data api_update_antenna(account_id: String, antenna: notecli::models::Antenna) -> notecli::models::Antenna = $crate::commands::timeline::api_update_antenna;
        data api_clear_timeline_cache(account_id: String, timeline_key: String) -> u32 = $crate::commands::timeline::api_clear_timeline_cache;
        data api_get_antenna_notes(account_id: String, antenna_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_antenna_notes;
        data api_get_favorites(account_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_favorites;
        data api_get_featured_notes(account_id: String, limit: Option<i64>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_featured_notes;
        data api_get_mentions(account_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>, visibility: Option<String>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_mentions;
        data api_get_clips(account_id: String) -> Vec<notecli::models::Clip> = $crate::commands::timeline::api_get_clips;
        data api_get_clip_notes(account_id: String, clip_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_clip_notes;
        data api_get_channels(account_id: String) -> Vec<notecli::models::Channel> = $crate::commands::timeline::api_get_channels;
        data api_search_channels(account_id: String, query: String) -> Vec<notecli::models::Channel> = $crate::commands::timeline::api_search_channels;
        data api_get_channel_notes(account_id: String, channel_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_channel_notes;
        data api_get_role_notes(account_id: String, role_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_role_notes;
        data api_get_note(account_id: String, note_id: String) -> notecli::models::NormalizedNote = $crate::commands::timeline::api_get_note;
        data api_create_note(account_id: String, params: notecli::models::CreateNoteParams, channel_id: Option<String>) -> notecli::models::NormalizedNote = $crate::commands::timeline::api_create_note;
        data api_update_note(account_id: String, note_id: String, params: notecli::models::CreateNoteParams) -> () = $crate::commands::timeline::api_update_note;
        data api_delete_note(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_delete_note;
        data api_create_reaction(account_id: String, note_id: String, reaction: String) -> () = $crate::commands::timeline::api_create_reaction;
        data api_delete_reaction(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_delete_reaction;
        data api_vote_poll(account_id: String, note_id: String, choice: u32) -> () = $crate::commands::timeline::api_vote_poll;
        data api_get_note_reactions(account_id: String, note_id: String, reaction_type: Option<String>, limit: Option<u32>, until_id: Option<String>) -> Vec<notecli::models::NormalizedNoteReaction> = $crate::commands::timeline::api_get_note_reactions;
        data api_create_favorite(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_create_favorite;
        data api_delete_favorite(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_delete_favorite;
        data api_pin_note(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_pin_note;
        data api_unpin_note(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_unpin_note;
        data api_add_note_to_clip(account_id: String, clip_id: String, note_id: String) -> () = $crate::commands::timeline::api_add_note_to_clip;
        data api_remove_note_from_clip(account_id: String, clip_id: String, note_id: String) -> () = $crate::commands::timeline::api_remove_note_from_clip;
        data api_get_note_children(account_id: String, note_id: String, limit: Option<u32>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_note_children;
        data api_get_note_renotes(account_id: String, note_id: String, limit: Option<u32>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_note_renotes;
        data api_get_note_conversation(account_id: String, note_id: String, limit: Option<u32>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_note_conversation;
        data api_search_notes(account_id: String, query: String, options: Option<notecli::models::SearchOptions>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_search_notes;
        data api_search_notes_hanami(account_id: String, query: String, options: Option<notecli::models::SearchOptions>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_search_notes_hanami;
        data api_upload_file(account_id: String, file_name: String, file_data: Vec<u8>, content_type: String, is_sensitive: bool, folder_id: Option<String>) -> notecli::models::NormalizedDriveFile = $crate::commands::timeline::api_upload_file;
        data api_get_cached_timeline(account_id: String, timeline_type: String, limit: Option<i64>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_cached_timeline;
        data api_get_cached_timeline_before(account_id: String, timeline_type: String, before: String, before_note_id: Option<String>, limit: Option<i64>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_get_cached_timeline_before;
        data api_get_cache_date_range(account_id: String, timeline_type: String) -> Option<(String, String)> = $crate::commands::timeline::api_get_cache_date_range;
        data api_find_notes_by_identity(uri: String) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_find_notes_by_identity;
        data api_note_identity(uri: String) -> String = $crate::commands::timeline::api_note_identity;
        data api_search_notes_local(account_id: String, query: String, limit: Option<i64>, since_date: Option<String>, until_date: Option<String>, ascending: Option<bool>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_search_notes_local;
        data api_search_notes_cached_across(account_ids: Vec<String>, query: String, limit: Option<i64>, since_date: Option<String>, until_date: Option<String>, ascending: Option<bool>, author: Option<String>, has_files: Option<bool>, public_only: Option<bool>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::timeline::api_search_notes_cached_across;
        data api_delete_cached_note(account_id: String, note_id: String) -> () = $crate::commands::timeline::api_delete_cached_note;
        data api_verify_notes(account_id: String, note_ids: Vec<String>) -> $crate::commands::timeline::VerifyNotesResult = $crate::commands::timeline::api_verify_notes;
            // --- user (crates/notecore/src/commands/user.rs) ---
        data api_get_user(account_id: String, user_id: String) -> notecli::models::NormalizedUser = $crate::commands::user::api_get_user;
        data api_get_user_detail(account_id: String, user_id: String) -> notecli::models::NormalizedUserDetail = $crate::commands::user::api_get_user_detail;
        data api_get_user_notes(account_id: String, user_id: String, options: Option<notecli::models::TimelineOptions>) -> Vec<notecli::models::NormalizedNote> = $crate::commands::user::api_get_user_notes;
        data api_get_user_notes_filtered(account_id: String, params: serde_json::Value) -> serde_json::Value = $crate::commands::user::api_get_user_notes_filtered;
        data api_get_user_featured_notes(account_id: String, user_id: String, limit: Option<i64>, until_id: Option<String>) -> serde_json::Value = $crate::commands::user::api_get_user_featured_notes;
        data api_get_user_achievements(account_id: String, user_id: String) -> serde_json::Value = $crate::commands::user::api_get_user_achievements;
        data api_lookup_user(account_id: String, username: String, host: Option<String>) -> notecli::models::NormalizedUser = $crate::commands::user::api_lookup_user;
        data api_get_self(account_id: String) -> serde_json::Value = $crate::commands::user::api_get_self;
        data api_follow_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_follow_user;
        data api_unfollow_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_unfollow_user;
        data api_invalidate_follower(account_id: String, user_id: String) -> () = $crate::commands::user::api_invalidate_follower;
        data api_update_following(account_id: String, user_id: String, notify: Option<String>, with_replies: Option<bool>) -> () = $crate::commands::user::api_update_following;
        data api_update_user_memo(account_id: String, user_id: String, memo: String) -> () = $crate::commands::user::api_update_user_memo;
        data api_accept_follow_request(account_id: String, user_id: String) -> () = $crate::commands::user::api_accept_follow_request;
        data api_reject_follow_request(account_id: String, user_id: String) -> () = $crate::commands::user::api_reject_follow_request;
        data api_cancel_follow_request(account_id: String, user_id: String) -> () = $crate::commands::user::api_cancel_follow_request;
        data api_get_follow_requests(account_id: String, limit: Option<i64>) -> serde_json::Value = $crate::commands::user::api_get_follow_requests;
        data api_get_sent_follow_requests(account_id: String, limit: Option<i64>) -> serde_json::Value = $crate::commands::user::api_get_sent_follow_requests;
        data api_get_following(account_id: String, user_id: String, limit: Option<i64>, until_id: Option<String>) -> serde_json::Value = $crate::commands::user::api_get_following;
        data api_get_followers(account_id: String, user_id: String, limit: Option<i64>, until_id: Option<String>) -> serde_json::Value = $crate::commands::user::api_get_followers;
        data api_get_user_relations(account_id: String, user_ids: Vec<String>) -> serde_json::Value = $crate::commands::user::api_get_user_relations;
        data api_mute_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_mute_user;
        data api_unmute_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_unmute_user;
        data api_renote_mute_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_renote_mute_user;
        data api_unrenote_mute_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_unrenote_mute_user;
        data api_get_muted_users(account_id: String) -> Vec<String> = $crate::commands::user::api_get_muted_users;
        data api_get_muted_words(account_id: String) -> notecli::models::MutedWordsResult = $crate::commands::user::api_get_muted_words;
        data api_get_renote_muted_users(account_id: String) -> Vec<String> = $crate::commands::user::api_get_renote_muted_users;
        data api_block_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_block_user;
        data api_unblock_user(account_id: String, user_id: String) -> () = $crate::commands::user::api_unblock_user;
        data api_report_user(account_id: String, user_id: String, comment: String) -> () = $crate::commands::user::api_report_user;
        data api_add_user_to_list(account_id: String, list_id: String, user_id: String) -> () = $crate::commands::user::api_add_user_to_list;
        data api_remove_user_from_list(account_id: String, list_id: String, user_id: String) -> () = $crate::commands::user::api_remove_user_from_list;
        data api_search_users(account_id: String, query: Option<String>, origin: Option<String>, sort: Option<String>, state: Option<String>, limit: Option<i64>, offset: Option<i64>) -> serde_json::Value = $crate::commands::user::api_search_users;
        data api_search_users_by_query(account_id: String, query: String, limit: Option<i64>) -> serde_json::Value = $crate::commands::user::api_search_users_by_query;
        data api_search_hashtags(account_id: String, query: String, limit: Option<i64>) -> Vec<String> = $crate::commands::user::api_search_hashtags;
        data api_ap_show(account_id: String, uri: String) -> serde_json::Value = $crate::commands::user::api_ap_show;
        data api_get_user_raw(account_id: String, params: serde_json::Value) -> serde_json::Value = $crate::commands::user::api_get_user_raw;
        data api_probe_users_suspended(account_id: String, user_ids: Vec<String>) -> Vec<$crate::commands::user::UserSuspensionStatus> = $crate::commands::user::api_probe_users_suspended;
        data api_get_user_reactions(account_id: String, params: serde_json::Value) -> Vec<notecli::models::UserReaction> = $crate::commands::user::api_get_user_reactions;
        data api_get_user_pages_by(account_id: String, params: serde_json::Value) -> Vec<notecli::models::Page> = $crate::commands::user::api_get_user_pages_by;
        data api_get_user_flashs(account_id: String, params: serde_json::Value) -> Vec<notecli::models::Flash> = $crate::commands::user::api_get_user_flashs;
        data api_get_user_gallery_by(account_id: String, params: serde_json::Value) -> Vec<notecli::models::GalleryPost> = $crate::commands::user::api_get_user_gallery_by;
            // --- charts (crates/notecore/src/commands/charts.rs) ---
        data api_charts_user_notes(account_id: String, params: serde_json::Value) -> notecli::models::UserNotesChart = $crate::commands::charts::api_charts_user_notes;
        data api_charts_user_following(account_id: String, params: serde_json::Value) -> notecli::models::UserFollowingChart = $crate::commands::charts::api_charts_user_following;
        data api_charts_user_pv(account_id: String, params: serde_json::Value) -> notecli::models::UserPvChart = $crate::commands::charts::api_charts_user_pv;
        data api_charts_active_users(account_id: String, params: serde_json::Value) -> notecli::models::ActiveUsersChart = $crate::commands::charts::api_charts_active_users;
        data api_charts_notes(account_id: String, params: serde_json::Value) -> notecli::models::ServerNotesChart = $crate::commands::charts::api_charts_notes;
        data api_charts_users(account_id: String, params: serde_json::Value) -> notecli::models::ServerUsersChart = $crate::commands::charts::api_charts_users;
        data api_charts_federation(account_id: String, params: serde_json::Value) -> notecli::models::FederationChart = $crate::commands::charts::api_charts_federation;
        data api_charts_ap_request(account_id: String, params: serde_json::Value) -> notecli::models::ApRequestChart = $crate::commands::charts::api_charts_ap_request;
        data api_charts_drive(account_id: String, params: serde_json::Value) -> notecli::models::ServerDriveChart = $crate::commands::charts::api_charts_drive;
            // --- clips (crates/notecore/src/commands/clips.rs) ---
        data api_get_clip(account_id: String, params: serde_json::Value) -> notecli::models::Clip = $crate::commands::clips::api_get_clip;
        data api_get_my_favorite_clips(account_id: String, params: serde_json::Value) -> Vec<notecli::models::Clip> = $crate::commands::clips::api_get_my_favorite_clips;
        data api_create_clip(account_id: String, params: serde_json::Value) -> notecli::models::Clip = $crate::commands::clips::api_create_clip;
        data api_favorite_clip(account_id: String, params: serde_json::Value) -> () = $crate::commands::clips::api_favorite_clip;
        data api_unfavorite_clip(account_id: String, params: serde_json::Value) -> () = $crate::commands::clips::api_unfavorite_clip;
        data api_get_user_clips(account_id: String, params: serde_json::Value) -> Vec<notecli::models::Clip> = $crate::commands::clips::api_get_user_clips;
            // --- lists (crates/notecore/src/commands/lists.rs) ---
        data api_get_list(account_id: String, params: serde_json::Value) -> notecli::models::UserList = $crate::commands::lists::api_get_list;
        data api_get_user_lists_by(account_id: String, params: serde_json::Value) -> Vec<notecli::models::UserList> = $crate::commands::lists::api_get_user_lists_by;
        data api_favorite_list(account_id: String, params: serde_json::Value) -> () = $crate::commands::lists::api_favorite_list;
        data api_unfavorite_list(account_id: String, params: serde_json::Value) -> () = $crate::commands::lists::api_unfavorite_list;
            // --- drafts (crates/notecore/src/commands/drafts.rs) ---
        data api_get_drafts(account_id: String, params: serde_json::Value) -> Vec<notecli::models::NoteDraft> = $crate::commands::drafts::api_get_drafts;
        data api_create_draft(account_id: String, params: serde_json::Value) -> notecli::models::NoteDraft = $crate::commands::drafts::api_create_draft;
        data api_update_draft(account_id: String, params: serde_json::Value) -> notecli::models::NoteDraft = $crate::commands::drafts::api_update_draft;
        data api_delete_draft(account_id: String, params: serde_json::Value) -> () = $crate::commands::drafts::api_delete_draft;
            // --- federation (crates/notecore/src/commands/federation.rs) ---
        data api_get_federation_instances(account_id: String, params: serde_json::Value) -> Vec<$crate::commands::federation::FederationInstance> = $crate::commands::federation::api_get_federation_instances;
        data api_get_federation_instance(account_id: String, params: serde_json::Value) -> $crate::commands::federation::FederationInstance = $crate::commands::federation::api_get_federation_instance;
            // --- messaging (crates/notecore/src/commands/messaging.rs) ---
        data api_get_notifications(account_id: String, options: Option<notecli::models::TimelineOptions>) -> Vec<notecli::models::NormalizedNotification> = $crate::commands::messaging::api_get_notifications;
        data api_get_notifications_grouped(account_id: String, options: Option<notecli::models::TimelineOptions>) -> Vec<notecli::models::NormalizedNotification> = $crate::commands::messaging::api_get_notifications_grouped;
        data api_get_unread_notification_count(account_id: String) -> i64 = $crate::commands::messaging::api_get_unread_notification_count;
        data api_mark_all_notifications_as_read(account_id: String) -> () = $crate::commands::messaging::api_mark_all_notifications_as_read;
        data api_get_unread_chat(account_id: String) -> bool = $crate::commands::messaging::api_get_unread_chat;
        data api_get_chat_history(account_id: String, limit: Option<i64>, room: Option<bool>, cache: Option<bool>) -> Vec<notecli::models::ChatMessage> = $crate::commands::messaging::api_get_chat_history;
        data api_get_chat_user_messages(account_id: String, user_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>, cache: Option<bool>) -> Vec<notecli::models::ChatMessage> = $crate::commands::messaging::api_get_chat_user_messages;
        data api_get_chat_room_messages(account_id: String, room_id: String, limit: Option<i64>, since_id: Option<String>, until_id: Option<String>, cache: Option<bool>) -> Vec<notecli::models::ChatMessage> = $crate::commands::messaging::api_get_chat_room_messages;
        data api_create_chat_message(account_id: String, user_id: Option<String>, room_id: Option<String>, text: Option<String>, file_id: Option<String>) -> notecli::models::ChatMessage = $crate::commands::messaging::api_create_chat_message;
        data api_get_cached_chat_history(account_id: String, limit: Option<i64>) -> Vec<notecli::models::ChatMessage> = $crate::commands::messaging::api_get_cached_chat_history;
        data api_get_cached_chat_thread_messages(account_id: String, thread_id: String, until_id: Option<String>, limit: Option<i64>) -> Vec<notecli::models::ChatMessage> = $crate::commands::messaging::api_get_cached_chat_thread_messages;
        data api_get_cached_chat_latest_message_id(account_id: String, thread_id: String) -> Option<String> = $crate::commands::messaging::api_get_cached_chat_latest_message_id;
        data api_react_chat_message(account_id: String, message_id: String, reaction: String) -> () = $crate::commands::messaging::api_react_chat_message;
        data api_unreact_chat_message(account_id: String, message_id: String, reaction: String) -> () = $crate::commands::messaging::api_unreact_chat_message;
        data api_delete_chat_message(account_id: String, message_id: String) -> () = $crate::commands::messaging::api_delete_chat_message;
            // --- admin (crates/notecore/src/commands/admin.rs) ---
        data load_accounts() -> Vec<notecli::models::AccountPublic> = $crate::commands::admin::load_accounts;
        data cache_stats() -> $crate::commands::admin::CacheStats = $crate::commands::admin::cache_stats;
        data account_cache_count(account_id: String) -> i64 = $crate::commands::admin::account_cache_count;
        data clear_account_cache(account_id: String) -> u64 = $crate::commands::admin::clear_account_cache;
        data clear_all_cache() -> u64 = $crate::commands::admin::clear_all_cache;
        data apply_eviction_config(config: notecli::db::EvictionConfig) -> u64 = $crate::commands::admin::apply_eviction_config;
        data default_eviction_config() -> notecli::db::EvictionConfig = $crate::commands::admin::default_eviction_config;
        data chat_cache_stats() -> $crate::commands::admin::ChatCacheStats = $crate::commands::admin::chat_cache_stats;
        data chat_cache_count(account_id: String) -> i64 = $crate::commands::admin::chat_cache_count;
        data clear_chat_cache_for_account(account_id: String) -> u64 = $crate::commands::admin::clear_chat_cache_for_account;
        data apply_chat_eviction_config(config: notecli::db::ChatEvictionConfig) -> u64 = $crate::commands::admin::apply_chat_eviction_config;
        data default_chat_eviction_config() -> notecli::db::ChatEvictionConfig = $crate::commands::admin::default_chat_eviction_config;
        data create_guest_account(host: String, software: String) -> notecli::models::AccountPublic = $crate::commands::admin::create_guest_account;
        data load_server_detections() -> Vec<notecli::models::ServerDetection> = $crate::commands::admin::load_server_detections;
        data get_server_detection(host: String) -> notecli::models::ServerDetection = $crate::commands::admin::get_server_detection;
        data detect_server(host: String) -> notecli::models::ServerDetection = $crate::commands::admin::detect_server;
            // --- content (crates/notecore/src/commands/content.rs) ---
        data api_get_endpoints(host: String) -> Vec<String> = $crate::commands::content::api_get_endpoints;
        data api_get_endpoint_params(host: String, endpoint: String) -> Vec<String> = $crate::commands::content::api_get_endpoint_params;
        data api_get_user_policies(account_id: String) -> std::collections::HashMap<String, bool> = $crate::commands::content::api_get_user_policies;
        data api_update_user_setting(account_id: String, key: String, value: bool) -> () = $crate::commands::content::api_update_user_setting;
        data api_get_server_emojis(account_id: String, refresh: bool) -> Vec<notecli::models::ServerEmoji> = $crate::commands::content::api_get_server_emojis;
        data api_get_pinned_reactions(account_id: String) -> Vec<String> = $crate::commands::content::api_get_pinned_reactions;
        data api_get_server_stats(account_id: String) -> serde_json::Value = $crate::commands::content::api_get_server_stats;
        data api_get_meta_detail(account_id: String) -> serde_json::Value = $crate::commands::content::api_get_meta_detail;
        data api_get_roles(account_id: String) -> serde_json::Value = $crate::commands::content::api_get_roles;
        data api_get_role_users(account_id: String, role_id: String, limit: Option<i64>, offset: Option<i64>) -> serde_json::Value = $crate::commands::content::api_get_role_users;
        data api_get_announcements(account_id: String, limit: Option<i64>, is_active: Option<bool>) -> serde_json::Value = $crate::commands::content::api_get_announcements;
        data api_read_announcement(account_id: String, announcement_id: String) -> () = $crate::commands::content::api_read_announcement;
        data api_get_pages(account_id: String, endpoint: String, limit: Option<i64>) -> Vec<notecli::models::Page> = $crate::commands::content::api_get_pages;
        data api_get_page(account_id: String, page_id: String) -> serde_json::Value = $crate::commands::content::api_get_page;
        data api_like_page(account_id: String, page_id: String) -> () = $crate::commands::content::api_like_page;
        data api_unlike_page(account_id: String, page_id: String) -> () = $crate::commands::content::api_unlike_page;
        data api_get_gallery_posts(account_id: String, limit: Option<i64>, until_id: Option<String>) -> Vec<notecli::models::GalleryPost> = $crate::commands::content::api_get_gallery_posts;
        data api_like_gallery_post(account_id: String, post_id: String) -> () = $crate::commands::content::api_like_gallery_post;
        data api_unlike_gallery_post(account_id: String, post_id: String) -> () = $crate::commands::content::api_unlike_gallery_post;
        data api_get_flashes(account_id: String, endpoint: String, limit: Option<i64>) -> serde_json::Value = $crate::commands::content::api_get_flashes;
        data api_get_flash(account_id: String, flash_id: String) -> serde_json::Value = $crate::commands::content::api_get_flash;
        data api_like_flash(account_id: String, flash_id: String) -> () = $crate::commands::content::api_like_flash;
        data api_unlike_flash(account_id: String, flash_id: String) -> () = $crate::commands::content::api_unlike_flash;
        data api_get_drive_folders(account_id: String, folder_id: Option<String>, limit: Option<i64>) -> serde_json::Value = $crate::commands::content::api_get_drive_folders;
        data api_get_drive_files(account_id: String, folder_id: Option<String>, limit: Option<i64>, file_type: Option<String>) -> serde_json::Value = $crate::commands::content::api_get_drive_files;
        data api_delete_drive_file(account_id: String, file_id: String) -> () = $crate::commands::content::api_delete_drive_file;
        data api_create_drive_folder(account_id: String, name: String, parent_id: Option<String>) -> $crate::commands::content::CreatedDriveFolder = $crate::commands::content::api_create_drive_folder;
        data api_update_drive_folder(account_id: String, folder_id: String, name: String) -> () = $crate::commands::content::api_update_drive_folder;
        data api_delete_drive_folder(account_id: String, folder_id: String) -> () = $crate::commands::content::api_delete_drive_folder;
        data api_update_drive_file(account_id: String, file_id: String, name: Option<String>, comment: Option<String>, is_sensitive: Option<bool>) -> () = $crate::commands::content::api_update_drive_file;
        data api_move_drive_files(account_id: String, file_ids: Vec<String>, folder_id: Option<String>) -> () = $crate::commands::content::api_move_drive_files;
        data api_update_page(account_id: String, params: serde_json::Value) -> serde_json::Value = $crate::commands::content::api_update_page;
        data api_update_flash(account_id: String, params: serde_json::Value) -> serde_json::Value = $crate::commands::content::api_update_flash;
        data api_get_note_raw(account_id: String, params: serde_json::Value) -> serde_json::Value = $crate::commands::content::api_get_note_raw;
        data api_get_drive_file(account_id: String, params: serde_json::Value) -> serde_json::Value = $crate::commands::content::api_get_drive_file;
        data api_request(account_id: String, endpoint: String, params: Option<serde_json::Value>) -> serde_json::Value = $crate::commands::content::api_request;
        data api_fetch_account_theme(account_id: String) -> serde_json::Value = $crate::commands::content::api_fetch_account_theme;
        data api_get_registry_value(account_id: String, scope: Vec<String>, key: String) -> Option<serde_json::Value> = $crate::commands::content::api_get_registry_value;
        data api_set_registry_value(account_id: String, scope: Vec<String>, key: String, value: serde_json::Value) -> () = $crate::commands::content::api_set_registry_value;
        data api_delete_registry_value(account_id: String, scope: Vec<String>, key: String) -> () = $crate::commands::content::api_delete_registry_value;
        data api_list_registry_keys(account_id: String, scope: Vec<String>) -> std::collections::HashMap<String, String> = $crate::commands::content::api_list_registry_keys;
            // --- column_query (crates/notecore/src/commands/column_query.rs) ---
        data qir_validate(query: $crate::commands::column_query::QirQuery) -> $crate::commands::column_query::QirValidation = $crate::commands::column_query::qir_validate;
        data qir_search_cache(account_id: String, query: $crate::commands::column_query::QirQuery, timeline_key: Option<String>, limit: Option<u32>, max_scanned_rows: Option<u32>, cursor: Option<$crate::commands::column_query::QirSearchCursor>) -> $crate::commands::column_query::QirSearchResult = $crate::commands::column_query::qir_search_cache;
            // --- enrichment (crates/notecore/src/commands/enrichment.rs) ---
        data fetch_ogp(url: String, account_id: Option<String>) -> $crate::ogp::OgpData = $crate::commands::enrichment::fetch_ogp;
        data fetch_server_meta(host: String) -> serde_json::Value = $crate::commands::enrichment::fetch_server_meta;
        data fetch_image_base64(url: String) -> Option<String> = $crate::commands::enrichment::fetch_image_base64;
        data fetch_image_bytes(url: String) -> Vec<u8> = $crate::commands::enrichment::fetch_image_bytes;
            // --- streaming (crates/notecore/src/commands/streaming.rs) ---
        data stream_connect(account_id: String) -> () = $crate::commands::streaming::stream_connect;
        data stream_disconnect(account_id: String) -> () = $crate::commands::streaming::stream_disconnect;
        data stream_set_mode(account_id: String, mode: String, interval_ms: Option<u64>) -> () = $crate::commands::streaming::stream_set_mode;
        data stream_sub_note(account_id: String, note_id: String) -> () = $crate::commands::streaming::stream_sub_note;
        data stream_unsub_note(account_id: String, note_id: String) -> () = $crate::commands::streaming::stream_unsub_note;
            // --- pet (crates/notecore/src/commands/pet.rs) ---
        data pet_install(slug: String) -> $crate::pet_store::PetInfo = $crate::commands::pet::pet_install;
        data pet_load(slug: String) -> Option<$crate::commands::pet::PetLoaded> = $crate::commands::pet::pet_load;
        data pet_clear() -> () = $crate::commands::pet::pet_clear;
            // --- query (crates/notecore/src/commands/query.rs) ---
        data query_subscribe_timeline(account_id: String, timeline_type: String, list_id: Option<String>) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_timeline;
        data query_subscribe_antenna(account_id: String, antenna_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_antenna;
        data query_subscribe_channel(account_id: String, channel_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_channel;
        data query_subscribe_role(account_id: String, role_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_role;
        data query_subscribe_mentions(account_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_mentions;
        data query_subscribe_notifications(account_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_notifications;
        data query_subscribe_chat_user(account_id: String, other_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_chat_user;
        data query_subscribe_chat_room(account_id: String, room_id: String) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_subscribe_chat_room;
        data query_set_runtime_state(query_id: String, state: $crate::query_runtime::QueryRuntimeState) -> $crate::query_runtime::QuerySnapshot = $crate::commands::query::query_set_runtime_state;
        data query_close(query_id: String) -> () = $crate::commands::query::query_close;
        data query_get_snapshot(query_id: String) -> Option<$crate::query_runtime::QuerySnapshot> = $crate::commands::query::query_get_snapshot;
        data query_get_read_model_snapshot(query_id: String, limit: Option<u32>) -> Option<$crate::query_runtime::QueryReadModelSnapshot> = $crate::commands::query::query_get_read_model_snapshot;
            // --- utility (crates/notecore/src/commands/utility.rs) ---
        data get_cli_commands() -> Vec<notecli::cli::CliCommandInfo> = $crate::commands::utility::get_cli_commands;
        data get_openapi_spec() -> serde_json::Value = $crate::commands::utility::get_openapi_spec;
        data read_image_exif(url: String) -> Vec<$crate::commands::utility::ExifField> = $crate::commands::utility::read_image_exif;
        data image_cache_stats() -> $crate::commands::utility::ImageCacheStats = $crate::commands::utility::image_cache_stats;
        data warm_media(urls: Vec<String>, h: Option<u32>) -> u32 = $crate::commands::utility::warm_media;
        data clear_image_cache() -> () = $crate::commands::utility::clear_image_cache;
            // --- auth (crates/notecore/src/commands/auth.rs) ---
        data auth_start(host: String, permissions: Option<Vec<String>>) -> notecli::models::AuthSession = $crate::commands::auth::auth_start;
            // --- settings (crates/notecore/src/commands/settings.rs) ---
        data list_settings_files(subdir: String) -> Vec<String> = $crate::commands::settings::list_settings_files;
        data read_settings_file(subdir: String, name: String) -> String = $crate::commands::settings::read_settings_file;
        data write_settings_file(subdir: String, name: String, content: String) -> () = $crate::commands::settings::write_settings_file;
        data delete_settings_file(subdir: String, name: String) -> () = $crate::commands::settings::delete_settings_file;
        data rename_settings_file(subdir: String, old_name: String, new_name: String) -> () = $crate::commands::settings::rename_settings_file;
        data read_root_settings_file(name: String) -> String = $crate::commands::settings::read_root_settings_file;
        data read_notedeck_json() -> String = $crate::commands::settings::read_notedeck_json;
        data write_notedeck_json(content: String) -> () = $crate::commands::settings::write_notedeck_json;
        data update_performance_config(config: $crate::perf_config::PerformanceConfig) -> () = $crate::commands::settings::update_performance_config;
        data get_performance_config() -> $crate::perf_config::PerformanceConfig = $crate::commands::settings::get_performance_config;
            // --- vault (crates/notecore/src/commands/vault.rs) — main ウィンドウ限定、エラーは VaultError (`| 型` で宣言) ---
        data (window = main) vault_list_connections() -> Vec<$crate::vault::Connection> | $crate::vault::VaultError = $crate::commands::vault::vault_list_connections;
        data (window = main) vault_get_connection(id: String) -> Option<$crate::vault::Connection> | $crate::vault::VaultError = $crate::commands::vault::vault_get_connection;
        data (window = main) vault_get_secret_status(id: String) -> $crate::vault::connections_service::SecretStatus | $crate::vault::VaultError = $crate::commands::vault::vault_get_secret_status;
        data (window = main) vault_fetch(id: String, request: $crate::vault::fetch::VaultFetchRequest) -> $crate::vault::fetch::VaultFetchResponse | $crate::vault::VaultError = $crate::commands::vault::vault_fetch;
        data (window = main) vault_test_connection(id: String, test_path: Option<String>) -> $crate::vault::connections_service::VaultTestResult | $crate::vault::VaultError = $crate::commands::vault::vault_test_connection;

            // --- http (crates/notecore/src/commands/http.rs) ---
        data http_fetch(request: $crate::commands::http::HttpFetchRequest) -> $crate::commands::http::HttpFetchResponse = $crate::commands::http::http_fetch;
            // --- ai_chat (crates/notecore/src/commands/ai_chat.rs) ---
        data ai_chat_send(req: $crate::ai_chat_service::AiChatRequest) -> () = $crate::commands::ai_chat::ai_chat_send;
        data ai_chat_cancel(stream_id: String) -> () = $crate::commands::ai_chat::ai_chat_cancel;
        data ai_turn_run(req: $crate::ai_turn::AiTurnRequest) -> () = $crate::commands::ai_chat::ai_turn_run;
        data ai_turn_cancel(turn_id: String) -> () = $crate::commands::ai_chat::ai_turn_cancel;
        data ai_confirm_respond(request_id: String, accepted: bool) -> () = $crate::commands::ai_chat::ai_confirm_respond;
        data ai_confirm_shown(request_id: String) -> () = $crate::commands::ai_chat::ai_confirm_shown;
        }
    };
}
