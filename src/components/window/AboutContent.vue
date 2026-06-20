<script setup lang="ts">
import { getTauriVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { Check, HealthReport, Status } from '@/bindings'
import { useUpdater } from '@/composables/useUpdater'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { version as appVersion } from '../../../package.json'

const tauriVersion = ref('')
const rustVersion = ref('')
const copied = ref(false)
const uiStore = useUiStore()

// 自己診断 (#644): notecli doctor + ランタイム状態。About を開いた時に走らせ、
// 「情報をコピー」「バグを報告」の本文に診断を同梱する (VS Code Report Issue モデル)。
const health = shallowRef<HealthReport | null>(null)
const healthLoading = ref(false)
const healthError = ref<string | null>(null)

const STATUS_ICON: Record<Status, string> = {
  ok: 'ti ti-circle-check',
  warn: 'ti ti-alert-triangle',
  fail: 'ti ti-circle-x',
}

const STATUS_SYM: Record<Status, string> = {
  ok: '[OK]  ',
  warn: '[WARN]',
  fail: '[FAIL]',
}

function formatCheck(c: Check): string {
  return `${STATUS_SYM[c.status]} ${c.account ? `${c.account} ` : ''}${c.name}: ${c.message}${c.fix ? ` (→ ${c.fix})` : ''}`
}

const overallStatus = computed<Status>(() => {
  const checks = health.value?.doctor.checks ?? []
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
})

// 正常な項目は畳んで、注意・問題だけ出す (健康なら "正常" の一行で済む)。
const problemChecks = computed(() =>
  (health.value?.doctor.checks ?? []).filter((c) => c.status !== 'ok'),
)

const healthSummary = computed(() => {
  if (healthLoading.value) return '診断中...'
  if (healthError.value) return '診断に失敗しました'
  if (!health.value) return ''
  const fails = problemChecks.value.filter((c) => c.status === 'fail').length
  const warns = problemChecks.value.filter((c) => c.status === 'warn').length
  if (fails > 0) return `${fails} 件の問題`
  if (warns > 0) return `${warns} 件の警告`
  return '正常'
})

async function runHealthcheck() {
  if (healthLoading.value) return
  healthLoading.value = true
  healthError.value = null
  try {
    health.value = unwrap(await commands.runHealthcheck())
  } catch (e) {
    healthError.value = AppError.from(e).message
  } finally {
    healthLoading.value = false
  }
}

// 問題のある行だけをデバッグログ体裁に整形 (UI 表示・コピー・バグ報告で共用)。
// 正常時は空文字なのでブロックも本文の診断セクションも出ない。
const diagnosticsLog = computed<string>(() =>
  problemChecks.value.map(formatCheck).join('\n'),
)
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
  runHealthcheck()
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
  const info = infoRows.map((r) => `${r.label}: ${r.get()}`).join('\n')
  const diag = diagnosticsLog.value
  return diag ? `${info}\n\n# 診断\n\`\`\`\n${diag}\n\`\`\`` : info
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
  const diag = diagnosticsLog.value
  const diagSection = diag ? `\n\n## 診断\n\n\`\`\`\n${diag}\n\`\`\`` : ''
  const body = `## 現象\n\n<!-- 何が起きたか -->\n\n## 再現手順\n\n1.\n2.\n3.\n\n## 期待する動作\n\n<!-- 本来どうなるべきか -->\n\n## 環境\n\n${env}${diagSection}\n\n## スクリーンショット\n\n<!-- あれば添付 -->`
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

    <div :class="$style.diag">
      <div :class="$style.diagHead">
        <i
          :class="[
            healthLoading ? 'ti ti-loader-2' : healthError ? STATUS_ICON.fail : STATUS_ICON[overallStatus],
            $style.diagIcon,
            !healthLoading && !healthError && $style[overallStatus],
            healthError && $style.fail,
          ]"
        />
        <span :class="$style.diagSummary">診断: {{ healthSummary }}</span>
        <button class="_button" :class="$style.diagRefresh" :disabled="healthLoading" title="再診断" @click="runHealthcheck">
          <i class="ti ti-refresh" />
        </button>
      </div>
      <div v-if="healthError" :class="$style.diagError">{{ healthError }}</div>
      <!-- 問題のある行だけを log 言語でシンタックスハイライト (正常時は非表示) -->
      <div
        v-else-if="diagnosticsLog"
        :key="`diag-${highlighterLoaded}`"
        :class="$style.logBlock"
        v-html="highlightCode(diagnosticsLog, 'log')"
      />
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
  width: 48px;
  height: 48px;
  border-radius: 10px;
}

.aboutTitle {
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.7;
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

.diag {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px;
  font-size: 0.85em;
}

.diagHead {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.diagIcon {
  font-size: 1em;

  &.ok { color: var(--nd-success); }
  &.warn { color: var(--nd-warn); }
  &.fail { color: var(--nd-error); }
}

.diagSummary {
  color: var(--nd-fg);
  font-weight: 600;
}

.diagRefresh {
  position: absolute;
  right: 0;
  background: transparent;
  border: none;
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: pointer;
  padding: 2px 4px;

  &:hover { opacity: 1; }
  &:disabled { opacity: 0.3; cursor: default; }
}

.diagError {
  color: var(--nd-error);
  font-size: 0.9em;
}

.logBlock {
  text-align: left;
  font-size: 0.75em;
  line-height: 1.5;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-panelBorder);
  overflow: hidden;

  :global(pre) {
    margin: 0;
    padding: 8px 10px;
    max-height: 200px;
    overflow: auto;
    background: var(--nd-codeBg, var(--nd-panelHighlight));
    scrollbar-width: thin;
  }

  :global(code) {
    font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    white-space: pre-wrap;
    word-break: break-word;
    user-select: all;
  }
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
