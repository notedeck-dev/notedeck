/**
 * notes_cache の eviction policy。 notedeck の設定 (`cache.evictionPreset` 等) と
 * notecli の Tauri bindings (`EvictionConfig`) を結ぶ薄い変換層。
 *
 * 設計判断: notedeck の差別化要素は「過去ノートを一瞬でローカル全文検索」 なので、
 * デフォルトは notecli の `EvictionConfig::default()` (balanced) を尊重する。
 * 「ストレージ優先」を選びたいヘビーユーザーだけが明示的に下げる前提。
 */
import type { ChatEvictionConfig, EvictionConfig } from '@/bindings'
import type { NotedeckSettings } from '@/settings/schema'

export type EvictionPreset = NonNullable<
  NotedeckSettings['cache.evictionPreset']
>

/** 「検索優先」: 完全永続。eviction なし。 */
export const SEARCH_PRIORITY: EvictionConfig = {
  perAccountLimit: null,
  ttlDays: null,
}

/** 「バランス」: notecli の `EvictionConfig::default()` 相当。暴走防止のみ。 */
export const BALANCED: EvictionConfig = {
  perAccountLimit: 1_000_000,
  ttlDays: null,
}

/** 「ストレージ優先」: 旧デフォルト (notecli #3) と同等のヘビー掃除。 */
export const STORAGE_PRIORITY: EvictionConfig = {
  perAccountLimit: 50_000,
  ttlDays: 90,
}

/**
 * settings から EvictionConfig を解決する。 preset が `custom` のときは
 * `cache.perAccountLimit` / `cache.ttlDays` をそのまま使う (`undefined` は
 * `null` 扱い = 制限なし)。
 */
export function resolveEvictionConfig(
  settings: NotedeckSettings,
): EvictionConfig {
  const preset = settings['cache.evictionPreset'] ?? 'balanced'
  switch (preset) {
    case 'search-priority':
      return SEARCH_PRIORITY
    case 'storage-priority':
      return STORAGE_PRIORITY
    case 'custom':
      return {
        perAccountLimit: settings['cache.perAccountLimit'] ?? null,
        ttlDays: settings['cache.ttlDays'] ?? null,
      }
    default:
      return BALANCED
  }
}

/**
 * settings から ChatEvictionConfig を解決する (#460)。
 *
 * 設計判断:
 * - チャット履歴も notes と同じく「永続記録」を尊重し、デフォルトは notecli の
 *   `ChatEvictionConfig::default()` (per-account 1M cap、TTL なし) と同等。
 * - notes のような preset (検索優先 / バランス / ストレージ優先) は v1 では作らない。
 *   ユーザー要求が来てから C-phase で UI を足す。
 * - `chat.cacheEnabled` が false のときは「キャッシュ書込み禁止」モード。
 *   既に DB に入っているメッセージは退避方針を選びたい余地があるが、 v1 では
 *   eviction はそのまま走らせる (= 既存ローカル履歴は残る)。透過的に保ちたい。
 */
export function resolveChatEvictionConfig(
  settings: NotedeckSettings,
): ChatEvictionConfig {
  return {
    perAccountLimit: settings['chat.perAccountLimit'] ?? 1_000_000,
    ttlDays: settings['chat.ttlDays'] ?? null,
  }
}

export const PRESET_OPTIONS: ReadonlyArray<{
  value: EvictionPreset
  label: string
  hint: string
}> = [
  {
    value: 'search-priority',
    label: '検索優先',
    hint: '永続保存。過去ノートをいつまでも全文検索できる',
  },
  {
    value: 'balanced',
    label: 'バランス',
    hint: '実質永続 (アカウントあたり 1,000,000 件で hard cap)',
  },
  {
    value: 'storage-priority',
    label: 'ストレージ優先',
    hint: '90 日 / 50,000 件で自動削除。ディスク使用量を抑える',
  },
  {
    value: 'custom',
    label: 'カスタム',
    hint: '上限と TTL を個別に指定する',
  },
]
