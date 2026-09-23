-- V7: notes_cache に同一性キー (identity) 列を追加する (notedeck#1058)。
-- identity は正規化した ActivityPub object id。複数サーバーで観測した同じノートを
-- 束ねるためのキーで、導出規則は src/identity.rs が正本。
--
-- この migration は列追加と索引だけ。既存行の backfill は起動をブロックしないよう
-- `Database::backfill_identity_chunk` で起動後にバックグラウンドで行う
-- (V6 級の全行リライトは起動を分単位で止めるため)。未 backfill 行は '' で、
-- `find_notes_by_identity` は完了まで uri 列でフォールバックする。
--
-- 索引は部分索引にしない: `identity = ?` の束縛パラメータでは部分索引の条件
-- (identity != '') を planner が証明できず索引が使われない。'' 行は索引上で
-- 連続するので backfill のチャンク選択にも同じ索引が効く。

ALTER TABLE notes_cache ADD COLUMN identity TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_notes_cache_identity ON notes_cache(identity);
