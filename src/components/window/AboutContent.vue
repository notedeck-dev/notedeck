<script setup lang="ts">
import { getTauriVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { Check, HealthReport, Status } from '@/bindings'
import { useTutorialStore } from '@/composables/useTutorial'
import { useUpdater } from '@/composables/useUpdater'
import { formatHealthDuration, getStreamHealth } from '@/core/streamHealth'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { version as appVersion } from '../../../package.json'

const emit = defineEmits<{
  close: []
}>()

const tauriVersion = ref('')
const rustVersion = ref('')
const copied = ref(false)
const uiStore = useUiStore()
const tutorialStore = useTutorialStore()
const accountsStore = useAccountsStore()

const REPO_URL = 'https://github.com/hitalin/notedeck'
const SITE_URL = 'https://notedeck.hital.in'
const SPONSOR_URL = 'https://github.com/sponsors/hitalin'

// チュートリアル (= ヘルプ/案内) の再実行はここから。設定メニューではなく
// About に置く (チュートリアルは設定項目ではないため)。ほぼ一度しか使われない
// 機能なので CTA にはせず、リンク行 (formLink) の1つに置く。起動時に About は閉じる。
function openTutorial(): void {
  tutorialStore.start()
  emit('close')
}

// バージョン情報テーブルは普段は畳んでおく (必要なのはバグ報告・コピー時で、
// その2つは表示に依存せず infoRows から本文を生成する)
const infoOpen = ref(false)

// ロゴのイースターエッグ: クリックすると HEARTBEAT にちなんだ鼓動を打つ。
// 一度 class を外してから付け直すことで、連打や中断後も確実に再発火させる
const logoBeating = ref(false)
function beatLogo(): void {
  logoBeating.value = false
  requestAnimationFrame(() => {
    logoBeating.value = true
  })
}

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

// ストリーミング接続の診断 (#698)。doctor の checks と同じ形に整形して
// 合流させる: connected / 状態記録なし (カラム未表示等) は正常として出さず、
// reconnecting / disconnected だけを継続時間つきで出す。恒久障害の
// 「気づき」自体はカラムのオフラインバッジが担い、ここは診断・報告用。
const healthCheckedAt = ref(0)
const streamChecks = computed<Check[]>(() => {
  // 再診断ボタンで継続時間の表示を更新するための依存
  void healthCheckedAt.value
  // 手動オフラインモードは意図した切断なので、障害として診断やバグ報告に
  // 混ぜない
  if (useOfflineModeStore().isOfflineMode) return []
  const checks: Check[] = []
  for (const acc of accountsStore.accounts) {
    if (!acc.hasToken) continue
    const h = getStreamHealth(acc.id)
    if (!h || h.state === 'connected' || h.state === 'initializing') continue
    checks.push({
      name: 'streaming',
      status: h.state === 'disconnected' ? 'fail' : 'warn',
      message:
        h.state === 'disconnected'
          ? `ストリーム切断 (${formatHealthDuration(h.since)})`
          : `ストリーム再接続中 (${formatHealthDuration(h.since)})`,
      account: getAccountLabel(acc),
      fix: 'ネットワークとサーバーの状態を確認',
    })
  }
  return checks
})

// 正常な項目は畳んで、注意・問題だけ出す (健康なら "正常" の一行で済む)。
const problemChecks = computed(() => [
  ...(health.value?.doctor.checks ?? []).filter((c) => c.status !== 'ok'),
  ...streamChecks.value,
])

const overallStatus = computed<Status>(() => {
  if (problemChecks.value.some((c) => c.status === 'fail')) return 'fail'
  if (problemChecks.value.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
})

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
  healthCheckedAt.value = Date.now()
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
  const url = `${REPO_URL}/issues/new?labels=bug&body=${encodeURIComponent(body)}`
  openUrl(url)
}
</script>

<template>
  <div :class="$style.aboutContent">
    <!-- 本家 about-misskey ページ踏襲の hero: アイコン + 名前 + バージョン薄字 -->
    <div :class="$style.aboutHero">
      <button type="button" class="_button" :class="$style.logoBtn" aria-label="NoteDeck" @click="beatLogo">
        <img
          src="/favicon.svg"
          :class="[$style.aboutLogo, logoBeating && $style.beating]"
          alt=""
          @animationend="logoBeating = false"
        />
      </button>
      <button
        type="button"
        class="_button"
        :class="$style.aboutTitle"
        title="公式サイトを開く"
        @click="openUrl(SITE_URL)"
      >
        NoteDeck
      </button>
      <!-- バージョン表記自体がアップデート確認のタッチポイント (モバイルは表示のみ) -->
      <template v-if="!uiStore.isMobilePlatform">
        <button
          type="button"
          class="_button"
          :class="[$style.aboutVersion, isUpToDate && $style.versionOk]"
          title="アップデートを確認"
          :disabled="isChecking"
          @click="checkForUpdate(true)"
        >
          v{{ appVersion }}
          <i
            :class="[
              isChecking ? 'ti ti-loader-2 nd-spin' : isUpToDate ? 'ti ti-check' : 'ti ti-refresh',
              $style.versionIcon,
            ]"
          />
          <span v-if="isUpToDate">最新</span>
        </button>
        <button
          v-if="updateAvailable"
          type="button"
          class="_button"
          :class="$style.updatePill"
          :disabled="isInstalling"
          @click="installUpdate"
        >
          <i class="ti ti-download" />
          {{ isInstalling ? 'インストール中...' : `v${updateVersion} にアップデート` }}
        </button>
      </template>
      <div v-else :class="$style.aboutVersion">v{{ appVersion }}</div>
    </div>

    <div :class="$style.aboutLinks">
      <button type="button" class="_button" :class="$style.pillBtn" @click="openTutorial">
        <i class="ti ti-presentation-analytics" />
        チュートリアルを見る
      </button>
    </div>

    <!-- 本家 about-misskey の projectMembers 踏襲 (行の型は formLink に統一)。
         飛び先を Sponsors にすることで寄付導線を兼ねる -->
    <div :class="$style.formSection">
      <div :class="$style.formSectionLabel">開発者</div>
      <div :class="$style.sectionBody">
        <button type="button" class="_button" :class="$style.formLink" @click="openUrl(SPONSOR_URL)">
          <img src="https://github.com/hitalin.png?size=48" :class="$style.devAvatar" alt="" />
          <span>@hitalin</span>
          <span :class="$style.formLinkSuffix">GitHub Sponsors <i class="ti ti-external-link" /></span>
        </button>
      </div>
    </div>

    <!-- 本家 FormSection 踏襲 (DeckServerInfoColumn の formSection と同型) -->
    <div :class="$style.formSection">
      <div :class="$style.infoHead">
        <button
          type="button"
          class="_button"
          :class="[$style.formSectionLabel, $style.infoToggle, infoOpen && $style.infoOpen]"
          @click="infoOpen = !infoOpen"
        >
          バージョン情報
          <i class="ti ti-chevron-down" :class="$style.infoChevron" />
        </button>
        <!-- コピーされる本体はこのセクションの infoRows なのでここに置く -->
        <button
          class="_button"
          :class="[$style.infoCopy, copied && $style.infoCopied]"
          :title="copied ? 'コピーしました' : '情報をコピー'"
          @click="copyInfo"
        >
          <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
        </button>
      </div>
      <div v-if="infoOpen" :class="$style.aboutInfo">
        <div v-for="row in infoRows" :key="row.label" :class="$style.aboutRow">
          <span :class="$style.aboutLabel">{{ row.label }}:</span>
          <span :class="$style.aboutValue">{{ row.get() }}</span>
        </div>
      </div>
      <!-- バグ報告はバージョン情報 (と診断結果) を本文に同梱するのでこのセクションに置く -->
      <div :class="$style.sectionBody">
        <button type="button" class="_button" :class="$style.formLink" @click="reportBug">
          <i class="ti ti-bug" :class="$style.formLinkIcon" />
          <span>バグを報告</span>
          <span :class="$style.formLinkSuffix">GitHub Issues<i class="ti ti-external-link" /></span>
        </button>
      </div>
    </div>

    <div :class="$style.formSection">
      <div :class="$style.formSectionLabel">自己診断</div>
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
          <span :class="$style.diagSummary">{{ healthSummary }}</span>
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
    </div>
  </div>
</template>

<style lang="scss" module>
.aboutContent {
  display: flex;
  flex-direction: column;
}

// 本家 about-misskey の hero (container) 踏襲: 中央寄せ、アイコンの下に
// 名前、その下にバージョンを opacity 0.5 で置く
.aboutHero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 20px 16px 12px;
}

.logoBtn {
  display: block;
  border-radius: 10px;
}

.aboutLogo {
  display: block;
  width: 48px;
  height: 48px;
  border-radius: 10px;
}

.beating {
  animation: heartbeat 0.9s ease-in-out;
}

@keyframes heartbeat {
  0%, 100% { transform: scale(1); }
  15% { transform: scale(1.12); }
  30% { transform: scale(0.98); }
  45% { transform: scale(1.18); }
  70% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .beating {
    animation: none;
  }
}

// タイトル自体が公式サイトへの導線 (ロゴは鼓動イースターエッグに割り当て済み)
.aboutTitle {
  margin-top: 0.75em;
  color: var(--nd-fg);

  &:hover {
    color: var(--nd-accent);
    text-decoration: underline;
  }
}

.aboutVersion {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.5;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &.versionOk {
    color: var(--nd-accent);
    opacity: 0.9;
  }
}

.versionIcon {
  font-size: 0.9em;
}

// 更新があるときだけバージョンの直下に出すアクセント色ピル (pillBtn と同型)
.updatePill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 7px 14px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  font-weight: bold;
  font-size: 0.85em;
  transition: background var(--nd-duration-base);

  &:hover:not(:disabled) {
    background: hsl(from var(--nd-accent) h s calc(l + 5));
  }

  &:disabled {
    opacity: 0.7;
  }
}

// 本家 about-misskey の「I ❤ #Misskey」ボタン (MkButton rounded) 踏襲:
// 中央寄せのピル型ボタン。導線が増えてもピルを足すだけにする。
.aboutLinks {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 0 16px 16px;
}

// 本家 FormSection 踏襲 (DeckServerInfoColumn の formSection と同型)
.formSection {
  border-top: solid 0.5px var(--nd-divider);
}

.formSectionLabel {
  font-weight: bold;
  padding: 1em 16px 0;
  font-size: 0.85em;
}

// セクション本文の共通余白。行 (formLink) はこの中に置く
.sectionBody {
  padding: 10px 16px 14px;
}

.formLink {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  background: var(--nd-buttonBg);
  border-radius: var(--nd-radius-sm);
  font-size: 0.9em;
  color: var(--nd-fg);
  text-align: left;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.formLinkIcon {
  margin-right: 0.75em;
  flex-shrink: 0;
  opacity: 0.75;
}

.formLinkSuffix {
  margin-left: auto;
  opacity: 0.7;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 0.9em;
}

// 開発者行のアバター (formLink 行の高さに合わせた小サイズ)
.devAvatar {
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-full);
  margin-right: 0.75em;
  flex-shrink: 0;
}

.infoHead {
  position: relative;
}

// 情報コピー (対象 = このセクションの infoRows)。diagRefresh と同型のアイコンボタン
.infoCopy {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--nd-fg);
  opacity: 0.6;
  padding: 2px 4px;

  &:hover {
    opacity: 1;
  }

  &.infoCopied {
    color: var(--nd-accent);
    opacity: 1;
  }
}

// バージョン情報の折りたたみトグル (DeckServerInfoColumn の rulesToggle と同型)
.infoToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  color: var(--nd-fg);
  padding-bottom: 1em;

  &.infoOpen .infoChevron {
    transform: rotate(180deg);
  }
}

.infoChevron {
  opacity: 0.6;
  transition: transform var(--nd-duration-slow);
}

// 本家 MkButton (primary rounded) と同じ色使い: accent 背景 + fgOnAccent 太字、
// hover は明度 +5
.pillBtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  font-weight: bold;
  font-size: 0.85em;
  transition: background var(--nd-duration-base);

  &:hover {
    background: hsl(from var(--nd-accent) h s calc(l + 5));
  }
}

.aboutInfo {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 16px 12px;
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

.diag {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px 14px;
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

</style>
