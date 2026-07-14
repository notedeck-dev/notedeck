import { ref } from 'vue'
import { useUiStore } from '@/stores/ui'

const isChecking = ref(false)
const isUpToDate = ref(false)
const updateAvailable = ref(false)
const updateVersion = ref('')
const isInstalling = ref(false)
/** ダウンロード進捗 (0-100)。contentLength 不明時は null のまま */
const downloadProgress = ref<number | null>(null)
const updateError = ref<string | null>(null)

let pendingUpdate: import('@tauri-apps/plugin-updater').Update | null = null
let checked = false

async function checkForUpdate(force = false) {
  if (isChecking.value || useUiStore().isMobilePlatform) return
  if (!force && checked) return
  checked = true
  isChecking.value = true
  isUpToDate.value = false

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (update) {
      pendingUpdate = update
      updateAvailable.value = true
      updateVersion.value = update.version
    } else {
      isUpToDate.value = true
    }
  } catch (e) {
    console.warn('[updater] check failed:', e)
  } finally {
    isChecking.value = false
  }
}

async function installUpdate() {
  if (!pendingUpdate || isInstalling.value) return
  isInstalling.value = true
  updateError.value = null
  downloadProgress.value = null

  let total = 0
  let received = 0
  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        if (total > 0) downloadProgress.value = 0
      } else if (event.event === 'Progress') {
        received += event.data.chunkLength
        if (total > 0) {
          downloadProgress.value = Math.min(
            100,
            Math.round((received / total) * 100),
          )
        }
      } else if (event.event === 'Finished') {
        downloadProgress.value = 100
      }
    })
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (e) {
    console.error('[updater] install failed:', e)
    updateError.value =
      'アップデートに失敗しました。時間をおいて再試行してください。'
    isInstalling.value = false
    downloadProgress.value = null
  }
}

export function useUpdater() {
  return {
    isChecking,
    isUpToDate,
    updateAvailable,
    updateVersion,
    isInstalling,
    downloadProgress,
    updateError,
    checkForUpdate,
    installUpdate,
  }
}
