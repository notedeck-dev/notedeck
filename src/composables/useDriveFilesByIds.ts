import { type Ref, ref, watch } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** Misskey `drive/files/show` の生レスポンス（NormalizedDriveFile の superset）。 */
interface DriveFileRaw {
  id: string
  name: string
  type: string
  url: string
  thumbnailUrl: string | null
  size: number
  isSensitive: boolean
  comment?: string | null
  properties?: { width?: number | null; height?: number | null } | null
  blurhash?: string | null
}

// key: `${accountId}:${fileId}` — プロセス内の寿命全体で使い回す軽量キャッシュ
const fileCache = new Map<string, NormalizedDriveFile>()
const inFlight = new Map<string, Promise<NormalizedDriveFile | null>>()

function normalize(raw: DriveFileRaw): NormalizedDriveFile {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    url: raw.url,
    thumbnailUrl: raw.thumbnailUrl ?? null,
    size: raw.size,
    isSensitive: raw.isSensitive,
    comment: raw.comment ?? null,
    width: raw.properties?.width ?? null,
    height: raw.properties?.height ?? null,
    blurhash: raw.blurhash ?? null,
  }
}

async function fetchOne(
  accountId: string,
  fileId: string,
): Promise<NormalizedDriveFile | null> {
  const key = `${accountId}:${fileId}`
  const cached = fileCache.get(key)
  if (cached) return cached
  const existing = inFlight.get(key)
  if (existing) return existing
  const p = commands
    .apiGetDriveFile(accountId, { fileId } as never)
    .then((res) => {
      const raw = unwrap(res) as unknown as DriveFileRaw
      const file = normalize(raw)
      fileCache.set(key, file)
      return file
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, p)
  return p
}

/**
 * `fileIds` を NormalizedDriveFile に非同期解決する。
 * 期限切れ・削除済みファイルは結果から除外される（クラッシュさせない）。
 * 戻り値は `fileId -> file` の Map。呼び出し側は `map.get(id)` で引く。
 */
export function useDriveFilesByIds(
  accountId: Ref<string | undefined>,
  fileIds: Ref<string[]>,
): Ref<Map<string, NormalizedDriveFile>> {
  const files = ref<Map<string, NormalizedDriveFile>>(new Map())

  watch(
    // ids の同一性ではなく値で再実行するため join しておく
    () => [accountId.value, fileIds.value.join(',')] as const,
    async () => {
      const acc = accountId.value
      if (!acc) {
        files.value = new Map()
        return
      }
      const unique = Array.from(new Set(fileIds.value.filter((id) => id)))
      if (unique.length === 0) {
        files.value = new Map()
        return
      }
      const results = await Promise.all(unique.map((id) => fetchOne(acc, id)))
      const next = new Map<string, NormalizedDriveFile>()
      for (const f of results) {
        if (f) next.set(f.id, f)
      }
      files.value = next
    },
    { immediate: true },
  )

  return files
}
