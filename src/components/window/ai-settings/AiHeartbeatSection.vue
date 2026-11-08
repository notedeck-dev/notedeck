<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { HeartbeatProbeResult } from '@/bindings'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import FormNumber from '@/components/common/form/FormNumber.vue'
import FormSwitchRow from '@/components/common/form/FormSwitchRow.vue'
import {
  HEARTBEAT_DAILY_MAX_AI_RUNS_MAX,
  HEARTBEAT_DAILY_MAX_AI_RUNS_MIN,
  HEARTBEAT_INTERVAL_MAX_MINUTES,
  HEARTBEAT_INTERVAL_MIN_MINUTES,
  HEARTBEAT_MAX_SKIP_HOURS_MAX,
  HEARTBEAT_MAX_SKIP_HOURS_MIN,
  heartbeatConnectionId,
  modelsAfterSelecting,
  resolveAiConnection,
  resolveHeartbeatConnection,
  useAiConfig,
} from '@/composables/useAiConfig'
import { useAiHarnesses } from '@/composables/useAiHarnesses'
import { useHeartbeatStatus } from '@/composables/useHeartbeatStatus'
import { useVault } from '@/composables/useVault'
import {
  BUILTIN_TEMPLATES,
  connectionIconUrl,
} from '@/data/connectionTemplates'
import { i18n } from '@/i18n'
import { nativeField } from '@/i18n/native'
import { presetChipLabel } from '@/permissions/labels'
import { usePermissionsConfig } from '@/permissions/store'
import {
  classifyHeartbeatOutcome,
  heartbeatInputLooksTruncated,
  heartbeatSkipReason,
} from '@/services/heartbeatStatus'
import { isHeartbeatStepsEmpty } from '@/services/heartbeatSteps'
import { useSkillsStore } from '@/stores/skills'
import { useWindowsStore } from '@/stores/windows'
import { formatAbsoluteTime, formatTime } from '@/utils/formatTime'
import { openSafeUrl } from '@/utils/url'
import AiBudgetField from './AiBudgetField.vue'
import AiHeartbeatResidentRow from './AiHeartbeatResidentRow.vue'
import AiModelField from './AiModelField.vue'
import AiSettingsSection from './AiSettingsSection.vue'

defineProps<{
  /** 値が変わるたびにこの節を開く (アプリの通知から, #1165) */
  reveal?: number
}>()

/** 利用者向けの説明 (ローカル接続の context の上げ方はここ) */
const DOCS_URL = 'https://notedeck.io/docs/guide/ai'

const { config, save: saveConfig } = useAiConfig()
const windowsStore = useWindowsStore()
const skillsStore = useSkillsStore()
skillsStore.ensureLoaded()
const vault = useVault()
const harnesses = useAiHarnesses()
onMounted(() => {
  void vault.refresh()
  void harnesses.refresh()
})

function errorText(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e)
}

// --- 状態行と「今すぐ巡回する」(#1321) ---
// 「いま動いているか」が先に読めるように最上段に置く。状態は notemaid の観測値の写し

const {
  status,
  triggerNow: triggerHeartbeatNow,
  probe: probeHeartbeat,
} = useHeartbeatStatus()
const now = ref(Date.now())
const clock = setInterval(() => {
  now.value = Date.now()
}, 30_000)
onScopeDispose(() => clearInterval(clock))

function head(text: string | null | undefined): string {
  const t = (text ?? '').trim().split('\n')[0] ?? ''
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

/** 直近の結果の 1 行 (outcome の文字列は開集合なので prefix で種別に落とす) */
const outcomeText = computed<string>(() => {
  const s = status.value
  if (!s) return ''
  switch (classifyHeartbeatOutcome(s.lastOutcome)) {
    case 'never':
      return i18n.ts._aiHeartbeatSection.outcomeNever
    case 'reported':
      return i18n.ts._aiHeartbeatSection.outcomeReported
    case 'suppressed':
      return i18n.ts._aiHeartbeatSection.outcomeSuppressed
    case 'queued':
      return i18n.ts._aiHeartbeatSection.outcomeQueued
    case 'waiting-unreachable':
    case 'waiting-no-provider':
      return s.waiting
        ? nativeField(s.waiting, 'message')
        : i18n.ts._aiHeartbeatSection.outcomeWaiting
    case 'error':
      return i18n.tsx._aiHeartbeatSection.outcomeError({
        error: head(s.recentFailures[0]?.message),
      })
    case 'skipped':
      switch (heartbeatSkipReason(s.lastOutcome)) {
        case 'no-change':
          return i18n.ts._aiHeartbeatSection.outcomeSkippedNoChange
        case 'no-account':
          return i18n.ts._aiHeartbeatSection.outcomeSkippedNoAccount
        case 'no-skills':
          return i18n.ts._aiHeartbeatSection.outcomeSkippedNoSkills
        case 'disabled':
          return i18n.ts._aiHeartbeatSection.outcomeSkippedDisabled
        default:
          return i18n.ts._aiHeartbeatSection.outcomeSkipped
      }
    default:
      return i18n.ts._aiHeartbeatSection.outcomeSkipped
  }
})
const lastTickLine = computed<string>(() => {
  const s = status.value
  if (!s?.lastTickAt) return i18n.ts._aiHeartbeatSection.lastTickNever
  return i18n.tsx._aiHeartbeatSection.lastTick({
    time: formatTime(s.lastTickAt, now.value),
    result: outcomeText.value,
  })
})
const lastTickTitle = computed(() =>
  formatAbsoluteTime(status.value?.lastTickAt),
)
const nextTickLine = computed<string>(() => {
  const s = status.value
  if (s?.running) return i18n.ts._aiHeartbeatSection.running
  if (!s?.nextTickAt || !config.value.heartbeat.enabled) return ''
  return i18n.tsx._aiHeartbeatSection.nextTick({
    time: formatAbsoluteTime(s.nextTickAt),
  })
})
/** 応答待ちの時間切れだったときの一文 (設定は増やさず、生成設定へ導く) */
const timeoutHint = computed(
  () =>
    classifyHeartbeatOutcome(status.value?.lastOutcome) === 'error' &&
    status.value?.lastErrorKind === 'timeout',
)
/** 切り詰めの注記: 抑制 + ローカル接続 + 入力が推定を大きく下回る、のときだけ (可能性として) */
const truncationNote = computed<string>(() => {
  const s = status.value
  if (!s || classifyHeartbeatOutcome(s.lastOutcome) !== 'suppressed') return ''
  if (!heartbeatInputLooksTruncated(s.usage, s.provider?.local ?? false))
    return ''
  return i18n.tsx._aiHeartbeatSection.truncationNote({
    input: s.usage?.inputTokens ?? 0,
    estimated: s.usage?.estimatedInputTokens ?? 0,
  })
})

const runNowBusy = ref(false)
const runNowError = ref('')
async function runNow(): Promise<void> {
  if (runNowBusy.value || status.value?.running) return
  runNowBusy.value = true
  runNowError.value = ''
  try {
    // 保存の debounce を待たずに今の設定で走らせる (notemaid は ai.json5 を読む)
    if (!(await saveConfig())) {
      runNowError.value = i18n.ts._aiHeartbeatSection.saveFailed
      return
    }
    await triggerHeartbeatNow()
  } catch (e) {
    runNowError.value = i18n.tsx._aiHeartbeatSection.runNowFailed({
      reason: errorText(e),
    })
  } finally {
    runNowBusy.value = false
  }
}

// --- 巡回の手順 (#1162): 予約 skill HEARTBEAT.md の編集入口と「空なら巡回しない」の案内 ---
// どの skill を heartbeat 対象にするかは skill 側の frontmatter (`mode: heartbeat`)

const stepsEmpty = computed(() =>
  skillsStore.heartbeatSkills.every((s) => isHeartbeatStepsEmpty(s.content)),
)
const stepsOpening = ref(false)
const stepsError = ref<string | null>(null)

async function editSteps(): Promise<void> {
  if (stepsOpening.value) return
  stepsOpening.value = true
  stepsError.value = null
  try {
    const skillId = await skillsStore.seedHeartbeatSteps()
    windowsStore.open('skill-edit', { skillId })
  } catch (e) {
    stepsError.value = i18n.tsx._aiHeartbeatSection.stepsOpenFailed({
      reason: errorText(e),
    })
  } finally {
    stepsOpening.value = false
  }
}

// --- 巡回に使う AI (#1321) ---
// 選ぶのは接続だけ。モデルは接続ごとの models[接続 id]。空 = チャットの接続に追従。
// 有効 / 無効を問わず出す (有効にする前に接続を選んで試走できるように)

const failedIcons = ref(new Set<string>())
const aiConnections = computed(() =>
  vault.connections.value.filter((c) => c.protocol != null),
)
const chat = computed(() =>
  resolveAiConnection(
    config.value,
    vault.connections.value,
    harnesses.harnesses.value,
  ),
)
const chatName = computed<string | null>(() => {
  const c = chat.value
  if (!c) return null
  return c.kind === 'vault'
    ? c.connection.name
    : (c.harness?.name ?? c.connectionId)
})
const followsChat = computed(() => config.value.heartbeat.connectionId === '')
const heartbeatConn = computed(() =>
  resolveHeartbeatConnection(
    config.value,
    vault.connections.value,
    harnesses.harnesses.value,
  ),
)
const heartbeatVault = computed(() =>
  heartbeatConn.value?.kind === 'vault' ? heartbeatConn.value.connection : null,
)
/** チャットが手元の CLI で巡回がそれに追従している (HEARTBEAT は動かない) */
const harnessBlocked = computed(() => heartbeatConn.value?.kind === 'harness')
/** 明示した接続が消えている (自動では書き換えない。チャットの activeConnectionId と同じ扱い) */
const explicitMissing = computed(
  () =>
    !followsChat.value &&
    !aiConnections.value.some(
      (c) => c.id === config.value.heartbeat.connectionId,
    ),
)
/** 巡回の接続がチャットと違う (モデル / 予算の欄はこのときだけ) */
const differsFromChat = computed(
  () =>
    !followsChat.value &&
    heartbeatVault.value != null &&
    heartbeatVault.value.id !== config.value.activeConnectionId,
)
const chatIsLocal = computed(
  () => chat.value?.kind === 'vault' && chat.value.connection.local,
)
/** 巡回の内容が端末の外へ出る (チャットはローカル、巡回はそうでない) */
const leavesDevice = computed(
  () =>
    chatIsLocal.value &&
    heartbeatVault.value != null &&
    !heartbeatVault.value.local,
)

function selectSameAsChat(): void {
  config.value.heartbeat.connectionId = ''
}
function selectConnection(id: string): void {
  config.value.heartbeat.connectionId = id
  config.value.models = modelsAfterSelecting(
    config.value.models,
    vault.connections.value.find((c) => c.id === id),
    (templateId) =>
      BUILTIN_TEMPLATES.find((t) => t.id === templateId)?.defaultModel,
  )
}

const heartbeatModel = computed<string>({
  get: () => {
    const id = heartbeatVault.value?.id
    return id ? (config.value.models[id] ?? '') : ''
  },
  set: (value) => {
    const id = heartbeatVault.value?.id
    if (id) config.value.models = { ...config.value.models, [id]: value }
  },
})
/** 接続はあるがモデルが未設定 (空白だけも)。巡回は待機し、試走もできない */
const modelMissing = computed(
  () => heartbeatVault.value != null && heartbeatModel.value.trim() === '',
)

// 「この接続を試す」: 通常の tick と同じ組み立ての prompt で 1 巡だけ回し、報告の tool を
// 呼べるかだけを見る。報告先への書込 / 通知は起きない。予算は消費する
const probing = ref(false)
const probeSeconds = ref(0)
const probeResult = ref<HeartbeatProbeResult | null>(null)
const probeError = ref('')
const canProbe = computed(
  () =>
    !probing.value &&
    !(status.value?.running ?? false) &&
    heartbeatVault.value != null &&
    !modelMissing.value,
)
/** 試走の世代。接続やモデルが変わったら進め、前の世代の結果は捨てる */
let probeGeneration = 0
watch(
  () => `${heartbeatConnectionId(config.value)}\n${heartbeatModel.value}`,
  () => {
    probeGeneration += 1
    probeResult.value = null
    probeError.value = ''
  },
)
async function probe(): Promise<void> {
  if (!canProbe.value) return
  const mine = ++probeGeneration
  probing.value = true
  probeSeconds.value = 0
  probeResult.value = null
  probeError.value = ''
  const started = Date.now()
  const tick = setInterval(() => {
    probeSeconds.value = Math.floor((Date.now() - started) / 1000)
  }, 1000)
  try {
    // 保存の debounce を待たずに今の接続で試す (前の接続に巡回の内容を送らない)
    if (!(await saveConfig())) {
      probeError.value = i18n.ts._aiHeartbeatSection.saveFailed
      return
    }
    const r = await probeHeartbeat()
    if (mine === probeGeneration) probeResult.value = r
  } catch (e) {
    if (mine === probeGeneration) probeError.value = errorText(e)
  } finally {
    clearInterval(tick)
    probing.value = false
  }
}
const probeLine = computed<string>(() => {
  const r = probeResult.value
  if (!r) return probeError.value
  switch (r.outcome) {
    case 'ok':
      return i18n.ts._aiHeartbeatSection.probeOk
    case 'no_tool':
      return i18n.ts._aiHeartbeatSection.probeNoTool
    case 'unreachable':
      return i18n.ts._aiHeartbeatSection.probeUnreachable
    case 'no_provider':
      return i18n.tsx._aiHeartbeatSection.probeNoProvider({
        reason: nativeField(r, 'message'),
      })
    default:
      return i18n.tsx._aiHeartbeatSection.probeError({
        error: head(r.message),
      })
  }
})
const probeUsageLine = computed<string>(() => {
  const u = probeResult.value?.usage
  if (!u) return ''
  return i18n.tsx._aiHeartbeatSection.probeUsage({
    input: u.inputTokens,
    estimated: u.estimatedInputTokens,
  })
})
const probeTimeout = computed(
  () =>
    probeResult.value?.outcome === 'error' &&
    probeResult.value.errorKind === 'timeout',
)

// --- 権限は権限ウィンドウ (#712 PR 2) に移動した ---
// 現在値の read-only chip + 導線だけ残す。
const { file: permissionsFile } = usePermissionsConfig()

const heartbeatPermChip = computed(() => {
  const profile = permissionsFile.value.principals['ai.heartbeat']
  return profile ? presetChipLabel(profile) : '-'
})

function openPermissionsWindow(): void {
  windowsStore.open('permissions')
}
</script>

<template>
  <AiSettingsSection
    icon="ti-activity-heartbeat"
    title="HEARTBEAT"
    :reveal="reveal"
    :badge="config.heartbeat.enabled ? i18n.tsx._aiHeartbeatSection.enabledWithInterval({ minutes: config.heartbeat.intervalMinutes }) : i18n.ts._common.disabled"
  >
    <!-- 最上段: 状態 1 行 + ボタン 1 つ (#1321)。いま動いているかが先に読める -->
    <div :class="$style.statusRow">
      <div :class="$style.statusText">
        <p :class="$style.statusLine" :title="lastTickTitle">
          <i class="ti" :class="status?.running ? 'ti-loader-2' : 'ti-clock-play'" />
          <span>{{ lastTickLine }}</span>
          <span v-if="nextTickLine" :class="$style.statusNext">· {{ nextTickLine }}</span>
        </p>
        <p v-if="timeoutHint" :class="$style.hint">{{ i18n.ts._aiHeartbeatSection.outcomeTimeoutHint }}</p>
        <p v-if="truncationNote" :class="$style.hint">
          <span>{{ truncationNote }}</span>
          <button type="button" class="_button" :class="$style.inlineLink" @click="openSafeUrl(DOCS_URL)">
            {{ i18n.ts._aiHeartbeatSection.docsLink }}
          </button>
        </p>
        <p v-if="runNowError" :class="$style.warn">
          <i class="ti ti-alert-triangle" />
          <span>{{ runNowError }}</span>
        </p>
      </div>
      <button
        class="_button"
        :class="$style.actionBtn"
        :disabled="runNowBusy || (status?.running ?? false)"
        @click="runNow"
      >
        <i class="ti ti-player-play" />
        {{ i18n.ts._aiHeartbeatSection.runNow }}
      </button>
    </div>
    <!-- ボタンの注記は tooltip ではなく見える文で (タッチでは tooltip に届かない、#975) -->
    <p :class="$style.hint">{{ i18n.ts._aiHeartbeatSection.runNowHint }}</p>

    <!-- 有効化 (TL フィルターと同じトグル) -->
    <FormSwitchRow
      icon="ti-activity-heartbeat"
      :label="i18n.ts._aiHeartbeatSection.enable"
      :on="config.heartbeat.enabled"
      @toggle="config.heartbeat.enabled = !config.heartbeat.enabled"
    />

    <!-- 巡回の手順 (#1162): 予約 skill HEARTBEAT.md の編集入口。空なら巡回しない -->
    <div v-if="config.heartbeat.enabled" :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.steps }}</span>
        <button
          class="_button"
          :class="$style.actionBtn"
          :disabled="stepsOpening"
          @click="editSteps"
        >
          <i class="ti ti-edit" />
          {{ i18n.ts._aiHeartbeatSection.editSteps }}
        </button>
      </div>
      <div v-if="stepsError" :class="$style.warn">
        <i class="ti ti-alert-circle" />
        <span>{{ stepsError }}</span>
      </div>
      <div v-else-if="stepsEmpty" :class="$style.warn">
        <i class="ti ti-alert-triangle" />
        <span>{{ i18n.ts._aiHeartbeatSection.stepsEmpty }}</span>
      </div>
    </div>

    <!-- 巡回に使う AI (#1321)。有効 / 無効を問わず出す -->
    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.provider }}</span>
      </div>
      <ChoiceCardGrid>
        <ChoiceCard
          :label="chatName ? i18n.tsx._aiHeartbeatSection.sameAsChat({ name: chatName }) : i18n.ts._aiHeartbeatSection.sameAsChatNone"
          :active="followsChat"
          icon="message-circle"
          @click="selectSameAsChat"
        />
        <ChoiceCard
          v-for="conn in aiConnections"
          :key="conn.id"
          :label="conn.name"
          :active="!followsChat && config.heartbeat.connectionId === conn.id"
          :title="conn.baseUrl"
          :icon-url="failedIcons.has(conn.id) ? null : connectionIconUrl(conn.baseUrl)"
          icon="plug-connected"
          @icon-error="failedIcons.add(conn.id)"
          @click="selectConnection(conn.id)"
        >
          <template #badge>
            <span v-if="conn.local" :class="$style.localBadge" :title="i18n.ts._aiConnectionSection.localBadge">
              <i class="ti ti-device-desktop" />
            </span>
          </template>
        </ChoiceCard>
      </ChoiceCardGrid>
      <!-- チャットが手元の CLI で巡回が「チャットと同じ」: 今までは無言だった -->
      <p v-if="harnessBlocked" :class="$style.warn">
        <i class="ti ti-alert-triangle" />
        <span>{{ i18n.ts._aiHeartbeatSection.harnessWarning }}</span>
      </p>
      <!-- 選んだ接続が消えている: 自動では書き換えず、戻すボタンを出す -->
      <p v-else-if="explicitMissing" :class="$style.warn">
        <i class="ti ti-alert-triangle" />
        <span>{{ i18n.ts._aiHeartbeatSection.connectionMissing }}</span>
        <button class="_button" :class="$style.inlineLink" @click="selectSameAsChat">
          {{ i18n.ts._aiHeartbeatSection.resetToChat }}
        </button>
      </p>
      <p v-if="modelMissing" :class="$style.warn">
        <i class="ti ti-alert-triangle" />
        <span>{{ i18n.ts._aiHeartbeatSection.modelMissing }}</span>
      </p>
      <!-- 試走: カードの直下。結果は 1 行 -->
      <div :class="$style.probeRow">
        <button
          class="_button"
          :class="$style.actionBtn"
          :disabled="!canProbe"
          @click="probe"
        >
          <i class="ti" :class="probing ? 'ti-loader-2' : 'ti-test-pipe'" />
          {{ probing ? i18n.tsx._aiHeartbeatSection.probing({ seconds: probeSeconds }) : i18n.ts._aiHeartbeatSection.probe }}
        </button>
        <span v-if="probeLine" :class="[$style.probeResult, { [$style.probeOk]: probeResult?.outcome === 'ok', [$style.probeBad]: probeResult?.outcome !== 'ok' }]">
          {{ probeLine }}
          <small v-if="probeUsageLine">({{ probeUsageLine }})</small>
        </span>
      </div>
      <p v-if="probeTimeout" :class="$style.hint">{{ i18n.ts._aiHeartbeatSection.outcomeTimeoutHint }}</p>
      <p :class="$style.hint">{{ i18n.ts._aiHeartbeatSection.probeBudgetNote }}</p>
      <!-- 開示の一文 (折りたたまない) -->
      <p :class="$style.hint">
        <i class="ti ti-info-circle" />
        <span>
          {{ i18n.ts._aiHeartbeatSection.disclosure }}
          <template v-if="leavesDevice"> {{ i18n.ts._aiHeartbeatSection.disclosureLeavesDevice }}</template>
        </span>
      </p>
      <!-- モデル: 巡回の接続がチャットと違うときだけ (同じなら接続セクションの欄がそれ) -->
      <template v-if="differsFromChat && heartbeatVault">
        <div :class="$style.subHeader">
          <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.modelForHeartbeat }}</span>
        </div>
        <AiModelField :connection="heartbeatVault" v-model="heartbeatModel" />
        <!-- 予算: チャットと違い、かつローカルでないときだけ (ローカルは無料) -->
        <AiBudgetField
          v-if="!heartbeatVault.local"
          :connection-id="heartbeatVault.id"
          :label="i18n.ts._aiHeartbeatSection.budgetForHeartbeat"
        />
      </template>
    </div>

    <!-- 常駐 (#1106): 巡回をアプリ終了後も続けるかは HEARTBEAT の一部として見せる -->
    <AiHeartbeatResidentRow v-if="config.heartbeat.enabled" />

    <!-- tick 間隔: 数値入力 (PerformanceEditor 風 1 行レイアウト) -->
    <div v-if="config.heartbeat.enabled" :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.tickInterval }}</span>
        <div :class="$style.fieldValue">
          <FormNumber
            v-model="config.heartbeat.intervalMinutes"
            :min="HEARTBEAT_INTERVAL_MIN_MINUTES"
            :max="HEARTBEAT_INTERVAL_MAX_MINUTES"
            :unit="i18n.ts._aiHeartbeatSection.minutes"
          />
        </div>
      </div>
    </div>

    <!-- デスクトップ通知 (#411 0.19.0): 重要発見を即気付ける。
         アプリにフォーカスがあるときは自動抑制。 -->
    <FormSwitchRow
      v-if="config.heartbeat.enabled"
      icon="ti-bell"
      :label="i18n.ts._aiHeartbeatSection.desktopNotification"
      :sub-label="i18n.ts._aiHeartbeatSection.desktopNotificationDescription"
      :on="config.heartbeat.desktopNotification"
      @toggle="config.heartbeat.desktopNotification = !config.heartbeat.desktopNotification"
    />

    <!-- Cheap Check First (#411): skill 側で cheapCheckCapabilities 宣言した
         heartbeat skill に対して、tick 開始時に「変化検知」用の軽量 capability
         を呼び、前回値と一致すれば AI 起動を skip する。
         opt-out 可能 (= 常に AI を叩きたい場合は OFF にする)。 -->
    <template v-if="config.heartbeat.enabled">
      <FormSwitchRow
        icon="ti-bolt"
        :label="i18n.ts._aiHeartbeatSection.cheapCheck"
        :sub-label="i18n.ts._aiHeartbeatSection.cheapCheckDescription"
        :on="config.heartbeat.cheapCheck.enabled"
        @toggle="config.heartbeat.cheapCheck.enabled = !config.heartbeat.cheapCheck.enabled"
      />

      <div v-if="config.heartbeat.cheapCheck.enabled" :class="$style.field">
        <div :class="$style.fieldHeader">
          <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.maxSkipHours }}</span>
          <div :class="$style.fieldValue">
            <FormNumber
              v-model="config.heartbeat.cheapCheck.maxSkipHours"
              :min="HEARTBEAT_MAX_SKIP_HOURS_MIN"
              :max="HEARTBEAT_MAX_SKIP_HOURS_MAX"
              :unit="i18n.ts._aiHeartbeatSection.hours"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- 安全装置 (#411): 1 日の AI 起動上限 + 上限到達時の動作 -->
    <template v-if="config.heartbeat.enabled">
      <div :class="$style.field">
        <div :class="$style.fieldHeader">
          <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.dailyMaxAiRuns }}</span>
          <div :class="$style.fieldValue">
            <FormNumber
              v-model="config.heartbeat.dailyMaxAiRuns"
              :min="HEARTBEAT_DAILY_MAX_AI_RUNS_MIN"
              :max="HEARTBEAT_DAILY_MAX_AI_RUNS_MAX"
              :unit="i18n.ts._aiHeartbeatSection.runsPerDay"
            />
          </div>
        </div>
      </div>

      <FormSwitchRow
        icon="ti-hand-stop"
        :label="i18n.ts._aiHeartbeatSection.disableOnDailyLimit"
        :sub-label="i18n.ts._aiHeartbeatSection.disableOnDailyLimitDescription"
        :on="config.heartbeat.onDailyLimit === 'disable'"
        @toggle="config.heartbeat.onDailyLimit = config.heartbeat.onDailyLimit === 'disable' ? 'warn' : 'disable'"
      />
    </template>

    <!-- HEARTBEAT 中の権限は権限ウィンドウで管理 (#712 PR 2) -->
    <template v-if="config.heartbeat.enabled">
      <div :class="$style.field">
        <label :class="$style.fieldLabel">
          <span>{{ i18n.ts._aiHeartbeatSection.permissions }}</span>
        </label>
        <div :class="$style.keyHint">
          <i class="ti ti-shield-lock" />
          <span>{{ heartbeatPermChip }}</span>
          <button class="_button" :class="$style.inlineLink" @click="openPermissionsWindow">
            {{ i18n.ts._aiHeartbeatSection.changeInPermissions }}
          </button>
        </div>
      </div>
    </template>
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;
@use '@/styles/buttons' as *;

.keyHint {
  @include key-hint;
  align-items: center;
}

.hint {
  @include key-hint;
  align-items: flex-start;
}

.warn {
  @include key-warn;
  align-items: center;
  flex-wrap: wrap;
}

// 「今すぐ巡回する」「巡回の手順を編集」「この接続を試す」。接続セクションの keyBtn と同じ見た目
.actionBtn {
  @include btn-secondary;
  white-space: nowrap;
}

// 最上段の状態行 (#1321)
.statusRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.statusText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.statusLine {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--nd-font-sm);
  font-variant-numeric: tabular-nums;
  min-width: 0;

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.statusNext {
  color: var(--nd-fgMuted);
  white-space: nowrap;
}

.probeRow {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.probeResult {
  font-size: var(--nd-font-xs);
  min-width: 0;
  overflow-wrap: anywhere;

  small {
    color: var(--nd-fgMuted);
    margin-left: 4px;
  }
}

.probeOk {
  color: var(--nd-accentText);
}

.probeBad {
  color: var(--nd-fg);
  opacity: 0.8;
}

.subHeader {
  margin-top: 10px;
}

// この端末の中で動くサービス (ローカル接続)
.localBadge {
  color: var(--nd-accentText);
}

// 「権限設定で変更」「チャットと同じに戻す」の導線
.inlineLink {
  color: var(--nd-link);
  text-decoration: underline;
  font-size: 1em;
}

.field { @include field; }
.fieldHeader { @include field-header; }
.fieldLabel { @include field-label; }
.fieldValue { @include field-value; }
</style>
