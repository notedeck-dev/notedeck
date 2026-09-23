-- V5: servers (アプリ側で計算した software/features のキャッシュ) を
-- server_detections (生の検出結果キャッシュ) に置き換える。
--
-- 旧 servers は「フロントで解決した software 名 + features 判定結果」を保存して
-- いたため、判定ロジックの更新が既存キャッシュに反映されない鮮度問題があった
-- (notedeck#782)。生の nodeinfo / meta を保存し、解決はアプリ側で読取時に行う。
-- 旧データは捨てる (次回アクセス時に再検出される 24h キャッシュのため損失は軽微)。

CREATE TABLE IF NOT EXISTS server_detections (
    host TEXT PRIMARY KEY,
    software_name TEXT NOT NULL,
    software_version TEXT NOT NULL,
    software_repository TEXT,
    meta_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

DROP TABLE IF EXISTS servers;
