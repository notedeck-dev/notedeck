/**
 * アプリの更新 (#1131)。確認・ダウンロード・インストールは Rust が 1 回だけ行い、
 * 状態 (`UpdateState`) を全窓へ流す。ここはその写しと操作の口だけ。
 * 以前は窓ごとに確認し、Update も確認した窓にしか無かった。
 */
import { computed, ref } from 'vue'
import { commands, events, type UpdateState } from '@/bindings'
import { i18n } from '@/i18n'
import { isTauri } from '@/utils/settingsFs'
import { unwrap } from '@/utils/tauriInvoke'

const state = ref<UpdateState>({
  phase: 'idle',
  version: null,
  progress: null,
  error: null,
})
let started = false

function start(): void {
  if (started || !isTauri) return
  started = true
  void events.updateState
    .listen((e) => {
      state.value = e.payload
    })
    .then(() => commands.updateStateGet())
    .then((r) => {
      state.value = unwrap(r)
    })
    .catch((e) => console.warn('[updater] state unavailable:', e))
}

const isChecking = computed(() => state.value.phase === 'checking')
const isUpToDate = computed(() => state.value.phase === 'upToDate')
const updateAvailable = computed(
  () =>
    state.value.phase === 'available' ||
    state.value.phase === 'installing' ||
    state.value.phase === 'ready',
)
const updateVersion = computed(() => state.value.version ?? '')
const isInstalling = computed(() => state.value.phase === 'installing')
/** 差し替えが済み、再起動を待っている状態 (Windows は到達しない) */
const updateReady = computed(() => state.value.phase === 'ready')
/** ダウンロード進捗 (0-100)。contentLength 不明時は null のまま */
const downloadProgress = computed(() =>
  state.value.phase === 'installing' ? state.value.progress : null,
)
const updateError = computed(() =>
  state.value.phase === 'failed' ? i18n.ts._useUpdater.installFailed : null,
)

async function checkForUpdate(force = false): Promise<void> {
  if (!isTauri) return
  try {
    state.value = unwrap(await commands.updateCheck(force))
  } catch (e) {
    console.warn('[updater] check failed:', e)
  }
}

async function installUpdate(): Promise<void> {
  if (!isTauri) return
  try {
    unwrap(await commands.updateInstall())
  } catch (e) {
    console.error('[updater] install failed:', e)
  }
}

async function restartToUpdate(): Promise<void> {
  if (!isTauri) return
  // 差し替え後の再起動は利用者に委ねる (VSCode の "Restart to Update")
  unwrap(await commands.updateRestart())
}

export function useUpdater() {
  start()
  return {
    isChecking,
    isUpToDate,
    updateAvailable,
    updateVersion,
    isInstalling,
    updateReady,
    downloadProgress,
    updateError,
    checkForUpdate,
    installUpdate,
    restartToUpdate,
  }
}
