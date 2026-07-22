import { resolveSoftware } from '@/adapters/registry'
import type {
  ServerFeatures,
  ServerInfo,
  ServerSoftware,
} from '@/adapters/types'
import type { ServerDetection } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * 生の検出結果 (notecli `server_detections`) を ServerInfo に解決する (#782)。
 *
 * フォーク解決 (`resolveSoftware`) と feature 判定はキャッシュに保存せず、
 * 常に読取時に行う — 判定ロジックの更新が古いキャッシュに埋まらない。
 */
export function detectionToServerInfo(det: ServerDetection): ServerInfo {
  const software = resolveSoftware(
    det.softwareName,
    det.softwareRepository ?? undefined,
  )
  const meta = parseMetaJson(det.metaJson)
  const url = (meta.iconUrl ?? meta.faviconUrl) as string | undefined
  const iconUrl = url
    ? url.startsWith('http')
      ? url
      : `https://${det.host}${url}`
    : `https://${det.host}/favicon.ico`
  return {
    host: det.host,
    software,
    version: det.softwareVersion,
    features: detectFeatures(software),
    iconUrl,
    themeColor: typeof meta.themeColor === 'string' ? meta.themeColor : null,
    infoImageUrl: resolveUrl(det.host, meta.infoImageUrl),
    notFoundImageUrl: resolveUrl(det.host, meta.notFoundImageUrl),
    serverErrorImageUrl: resolveUrl(det.host, meta.serverErrorImageUrl),
  }
}

/** meta 取得失敗時は "{}" が保存されている。壊れた JSON も空扱い。 */
function parseMetaJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function resolveUrl(host: string, raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  return raw.startsWith('http') ? raw : `https://${host}${raw}`
}

/**
 * 強制ネットワーク検出。SWR キャッシュを経由せず常に nodeinfo + meta を
 * 取りに行き、DB キャッシュも上書きする (Rust 側 detect_and_store)。
 * ログイン直後・ログイン前のサーバープレビューで使う。
 */
export async function detectServer(host: string): Promise<ServerInfo> {
  return detectionToServerInfo(unwrap(await commands.detectServer(host)))
}

/**
 * NoteDeck の前提は「最新版 Misskey または最新版を追従しているフォーク」。
 * 古いバージョンを名乗るサーバーはサポート対象外のため、版数ガードを設けず
 * Misskey 互換と判定したすべてで capability を有効化する。未対応サーバーでは
 * 実際の API 呼び出しがエラーで返るので fail-fast する。
 *
 * フォーク固有の capability はここに追加。カスタム TL や modeFlags は
 * customTimelines.ts のポリシー検出で動的に対応済み。静的に宣言が必要な
 * capability のみここで設定する。手順: DEVELOPMENT.md の "Fork support" を参照。
 */
function detectFeatures(software: ServerSoftware): ServerFeatures {
  const features = defaultFeatures()

  if (software !== 'unknown') {
    features.scheduledNotes = true
    features.groupedNotifications = true
    features.notesShowPartialBulk = true
  }

  return features
}

function defaultFeatures(): ServerFeatures {
  return {
    mastodonApi: false,
    reactions: true,
    customEmoji: true,
    drive: true,
    channels: true,
    antennas: true,
    quotes: true,
    scheduledNotes: false,
    groupedNotifications: false,
  }
}
