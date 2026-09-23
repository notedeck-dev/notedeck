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
        }
    };
}
