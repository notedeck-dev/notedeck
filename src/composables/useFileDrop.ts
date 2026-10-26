import { convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { onMounted, onUnmounted, ref } from 'vue'

/** 落とされたファイルのパスを WebView が読める URL にする */
export function droppedFileSrc(path: string): string {
  return convertFileSrc(path)
}

export type FileDropHandler = (
  paths: string[],
  position: { x: number; y: number },
) => void

export function useFileDrop(onDrop?: FileDropHandler) {
  const isDragging = ref(false)

  let unlisten: (() => void) | null = null

  onMounted(async () => {
    try {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        switch (event.payload.type) {
          case 'enter':
            isDragging.value = true
            break
          case 'leave':
            isDragging.value = false
            break
          case 'drop':
            isDragging.value = false
            onDrop?.(event.payload.paths, event.payload.position)
            break
        }
      })
    } catch {
      // Not running in Tauri (e.g. browser dev)
    }
  })

  onUnmounted(() => {
    unlisten?.()
  })

  return { isDragging }
}
