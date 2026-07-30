import { type Ref, ref, watch } from 'vue'
import { isSupportedSoftware, softwareDisplayName } from '@/adapters/registry'
import type { ServerInfo } from '@/adapters/types'
import { detectServer } from '@/core/server'

export type ServerStatus = 'idle' | 'checking' | 'ok' | 'unsupported' | 'error'

export function useServerPreview(host: Ref<string>, debounceMs = 350) {
  const status = ref<ServerStatus>('idle')
  const serverInfo = ref<ServerInfo | null>(null)
  const errorMessage = ref('')

  let timer: ReturnType<typeof setTimeout> | undefined
  let abortGeneration = 0

  watch(host, (raw) => {
    clearTimeout(timer)
    const trimmed = raw
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')

    if (!trimmed || !trimmed.includes('.')) {
      status.value = 'idle'
      serverInfo.value = null
      errorMessage.value = ''
      return
    }

    status.value = 'checking'
    serverInfo.value = null
    errorMessage.value = ''

    timer = setTimeout(() => {
      void probe(trimmed)
    }, debounceMs)
  })

  async function probe(trimmedHost: string) {
    const generation = ++abortGeneration
    status.value = 'checking'

    try {
      const info = await detectServer(trimmedHost)
      if (generation !== abortGeneration) return

      if (isSupportedSoftware(info.software)) {
        status.value = 'ok'
        serverInfo.value = info
      } else {
        // 未対応でも serverInfo は保持する（ファビコン表示に使う #853）
        status.value = 'unsupported'
        serverInfo.value = info
        const name = softwareDisplayName(info.software)
        errorMessage.value = name
          ? `${name} は未対応です`
          : 'Misskey サーバーではないため未対応です'
      }
    } catch {
      if (generation !== abortGeneration) return
      status.value = 'error'
      errorMessage.value = 'サーバーが見つかりません'
    }
  }

  return { status, serverInfo, errorMessage }
}
