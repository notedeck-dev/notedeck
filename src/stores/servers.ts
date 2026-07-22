import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { ServerInfo } from '@/adapters/types'
import { detectionToServerInfo } from '@/core/server'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * サーバー情報の表示用メモリキャッシュ (#782)。
 *
 * SWR (TTL 判定・in-flight dedup・stale 時の背景再検出) は
 * notecli::server_info に集約済みで、ここは「購読 + 解決済み ServerInfo の
 * メモリキャッシュ」のみを持つ。stale 行は Rust が返しつつ背景更新するため、
 * 反映は次回アクセス (または次回起動) となるが、サーバーのアイコン/テーマは
 * 変化が稀なので許容する。
 */
export const useServersStore = defineStore('servers', () => {
  // shallowRef + full Map replacement avoids deep reactivity on server info objects
  const servers = shallowRef(new Map<string, ServerInfo>())

  function setServer(host: string, info: ServerInfo) {
    const next = new Map(servers.value)
    next.set(host, info)
    servers.value = next
  }

  /** 起動時に DB キャッシュ全件をメモリへ展開する。 */
  async function loadCachedServers(): Promise<void> {
    const dets = unwrap(await commands.loadServerDetections())
    const next = new Map(servers.value)
    for (const det of dets) {
      next.set(det.host, detectionToServerInfo(det))
    }
    servers.value = next
  }

  async function getServerInfo(host: string): Promise<ServerInfo> {
    const cached = servers.value.get(host)
    if (cached) return cached
    const info = detectionToServerInfo(
      unwrap(await commands.getServerDetection(host)),
    )
    setServer(host, info)
    return info
  }

  function getServer(host: string): ServerInfo | undefined {
    return servers.value.get(host)
  }

  /**
   * 外部で取得した最新 ServerInfo をメモリキャッシュへ即時反映する。
   * DB キャッシュは取得元 (`detectServer` = Rust detect_and_store) が
   * 更新済みなので、ここではメモリのみ更新する。
   */
  function refreshServer(info: ServerInfo): void {
    setServer(info.host, info)
  }

  return {
    servers,
    loadCachedServers,
    getServerInfo,
    getServer,
    refreshServer,
  }
})
