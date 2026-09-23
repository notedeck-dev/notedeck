-- V3: Misskey chat メッセージのローカルキャッシュ。
-- notes_cache と同じ DB ファイル内に独立テーブルとして置く (WAL/incremental_vacuum 共有)。
-- 設計詳細は notedeck Issue #460 / ARCHITECTURE.md「チャットキャッシュ・アーキテクチャ」参照。

CREATE TABLE IF NOT EXISTS chat_messages_cache (
    message_id        TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    server_host       TEXT NOT NULL,
    -- "u:<userId>" (DM, partner = local 以外) or "r:<roomId>"
    thread_id         TEXT NOT NULL,
    thread_kind       TEXT NOT NULL CHECK (thread_kind IN ('dm','room')),
    from_user_id      TEXT NOT NULL,
    -- ISO 8601、文字列比較で時系列ソート可
    created_at        TEXT NOT NULL,
    -- ChatMessage 全量 (reactions / isRead / file 等を含む)
    message_json      TEXT NOT NULL,
    cached_at         INTEGER NOT NULL,
    PRIMARY KEY (message_id, account_id)
);

-- スレッド一覧 (history view) と thread タイムラインの両方を 1 系統でカバーする。
CREATE INDEX IF NOT EXISTS idx_chat_cache_thread
    ON chat_messages_cache (account_id, thread_id, created_at DESC);

-- TTL eviction 用。
CREATE INDEX IF NOT EXISTS idx_chat_cache_cached_at
    ON chat_messages_cache (cached_at);
