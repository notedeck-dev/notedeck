import type { CacheStats, ImageCacheStats } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** 手元のキャッシュ (ノート DB / 画像) の統計と掃除 (#1258) */
export function noteCacheStats(): Promise<CacheStats> {
  return commands.cacheStats().then(unwrap)
}

export function imageCacheStats(): Promise<ImageCacheStats> {
  return commands.imageCacheStats().then(unwrap)
}

/** 消した行数を返す */
export function clearAllNoteCache(): Promise<number> {
  return commands.clearAllCache().then(unwrap)
}

export function clearAccountNoteCache(accountId: string): Promise<number> {
  return commands.clearAccountCache(accountId).then(unwrap)
}

export function clearImageCache(): Promise<void> {
  return commands.clearImageCache().then((r) => {
    unwrap(r)
  })
}

/**
 * settings.json5 の掃き出し設定を Rust が解いて今すぐ適用し、消した行数を返す (#1131)。
 * プリセットの表は notecore (`eviction_preset.rs`) にだけある
 */
export function applyEvictionFromSettings(): Promise<number> {
  return commands.applyEvictionFromSettings().then(unwrap)
}
