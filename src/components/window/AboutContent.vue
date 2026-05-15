<script setup lang="ts">
import { getTauriVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onMounted, ref } from 'vue'
import { useUpdater } from '@/composables/useUpdater'
import { useUiStore } from '@/stores/ui'
import { commands } from '@/utils/tauriInvoke'
import { version as appVersion } from '../../../package.json'

const tauriVersion = ref('')
const rustVersion = ref('')
const copied = ref(false)
const uiStore = useUiStore()
const {
  isChecking,
  isUpToDate,
  updateAvailable,
  updateVersion,
  isInstalling,
  checkForUpdate,
  installUpdate,
} = useUpdater()

const buildDate = __BUILD_DATE__
const gitCommit = __GIT_COMMIT__

function parseWebView(ua: string): string {
  const webkit = ua.match(/AppleWebKit\/([\d.]+)/)
  return webkit ? `WebKit ${webkit[1]}` : 'N/A'
}

function parseOS(ua: string): string {
  const linux = ua.match(/Linux ([^\s;)]+)/)
  if (linux) return `Linux ${linux[1]}`
  const win = ua.match(/Windows NT ([\d.]+)/)
  if (win) return `Windows NT ${win[1]}`
  const mac = ua.match(/Mac OS X ([\d_]+)/)
  if (mac?.[1]) return `macOS ${mac[1].replace(/_/g, '.')}`
  return navigator.platform || 'N/A'
}

const webView = parseWebView(navigator.userAgent)
const os = parseOS(navigator.userAgent)

onMounted(async () => {
  try {
    tauriVersion.value = await getTauriVersion()
  } catch {
    // Fallback for environments where Tauri API is unavailable
  }
  try {
    rustVersion.value = await commands.getRustcVersion()
  } catch {
    // Fallback for environments where Tauri API is unavailable
  }
})

const infoRows = [
  { label: 'Version', get: () => appVersion },
  { label: 'Commit', get: () => gitCommit.slice(0, 12) },
  { label: 'Date', get: () => buildDate },
  { label: 'Tauri', get: () => tauriVersion.value || '...' },
  { label: 'Rust', get: () => rustVersion.value || '...' },
  { label: 'WebView', get: () => webView },
  { label: 'OS', get: () => os },
]

function getInfoText() {
  return infoRows.map((r) => `${r.label}: ${r.get()}`).join('\n')
}

async function copyInfo() {
  await navigator.clipboard.writeText(getInfoText())
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function reportBug() {
  const env = infoRows.map((r) => `- **${r.label}**: ${r.get()}`).join('\n')
  const body = `## 現象\n\n<!-- 何が起きたか -->\n\n## 再現手順\n\n1.\n2.\n3.\n\n## 期待する動作\n\n<!-- 本来どうなるべきか -->\n\n## 環境\n\n${env}\n\n## スクリーンショット\n\n<!-- あれば添付 -->`
  const url = `https://github.com/hitalin/notedeck/issues/new?labels=bug&body=${encodeURIComponent(body)}`
  openUrl(url)
}
</script>

<template>
  <div :class="$style.aboutContent">
    <div :class="$style.aboutHeader">
      <img src="/favicon.svg" :class="$style.aboutLogo" alt="NoteDeck" />
      <div :class="$style.aboutTitle">NoteDeck</div>
    </div>

    <div :class="$style.aboutInfo">
      <div v-for="row in infoRows" :key="row.label" :class="$style.aboutRow">
        <span :class="$style.aboutLabel">{{ row.label }}:</span>
        <span :class="$style.aboutValue">{{ row.get() }}</span>
      </div>
    </div>

    <div :class="$style.actions">
      <template v-if="!uiStore.isMobilePlatform">
        <div v-if="updateAvailable" :class="$style.actionGroup">
          <span :class="$style.updateVersion">v{{ appVersion }} → v{{ updateVersion }}</span>
          <button class="_button" :class="[$style.actionBtn, $style.updateBtn]" :disabled="isInstalling" @click="installUpdate">
            <i class="ti ti-download" />
            {{ isInstalling ? 'インストール中...' : 'アップデート' }}
          </button>
        </div>
        <div v-else :class="$style.actionGroup">
          <button class="_button" :class="[$style.actionBtn, { [$style.feedback]: isUpToDate }]" :disabled="isChecking" @click="checkForUpdate(true)">
            <i :class="isChecking ? 'ti ti-loader-2' : isUpToDate ? 'ti ti-check' : 'ti ti-refresh'" />
            {{ isChecking ? '確認中...' : isUpToDate ? '最新バージョンです' : 'アップデートを確認' }}
          </button>
        </div>
      </template>
      <div :class="$style.actionGroup">
        <button class="_button" :class="[$style.actionBtn, { [$style.feedback]: copied }]" @click="copyInfo">
          <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
          {{ copied ? 'コピーしました' : '情報をコピー' }}
        </button>
        <button class="_button" :class="$style.actionBtn" @click="reportBug">
          <i class="ti ti-bug" />
          バグを報告
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.aboutContent {
  display: flex;
  flex-direction: column;
}

.aboutHeader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px 8px;
}

.aboutLogo {
  width: 64px;
  height: 64px;
}

.aboutTitle {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--nd-fg);
}

.aboutInfo {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px;
  font-size: 0.85em;
  font-family: monospace;
}

.aboutRow {
  display: flex;
  gap: 8px;
}

.aboutLabel {
  color: var(--nd-fg);
  opacity: 0.5;
  min-width: 72px;
}

.aboutValue {
  color: var(--nd-fg);
  user-select: all;
}

.updateVersion {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--nd-accent);
  padding: 0 8px;
}

.updateBtn {
  background: var(--nd-accent) !important;
  color: var(--nd-fgOnAccent, #fff) !important;
}

.actions { @include action-bar; }
.actionGroup { @include action-group; }

.actionBtn {
  @include btn-action;

  &.feedback {
    color: var(--nd-accent);
  }
}
</style>
