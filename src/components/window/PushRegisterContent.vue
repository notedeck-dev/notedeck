<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  PushAccountRow,
  PushDistributor,
  PushProblem,
  PushReason,
  PushState,
} from '@/bindings'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { usePushRegistration } from '@/composables/usePushRegistration'
import { i18n } from '@/i18n'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useUiStore } from '@/stores/ui'
import { openSafeUrl } from '@/utils/url'

/**
 * サーバー単位の push の登録 (#330、Android)。本家の購読登録はアプリのトークンでは
 * 呼べないので、「有効にする」で NoteDeck が送り先をレジストリに書き、利用者は
 * コピーしたコードを本家 Web のスクラッチパッドで ▶ するだけ。届いた push で確定する
 * ので応答の貼り戻しは無い。窓を開いている間は数秒おきに読み直して進み具合を出す。
 * 使わなくても閉じている間は定期確認で届く (オプトイン)。
 */
const props = defineProps<{
  host: string
}>()

const DOCS_URL = 'https://notedeck.io/docs/guide/notifications'
const DISTRIBUTORS_URL = 'https://unifiedpush.org/users/distributors/'
const POLL_MS = 10_000

const push = usePushRegistration(() => props.host)
const accountsStore = useAccountsStore()
const uiStore = useUiStore()
const { copied, copyToClipboard } = useClipboardFeedback()
const { confirm } = useConfirm()
const choices = ref<PushDistributor[]>([])

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void push.refresh()
  timer = setInterval(() => void push.refresh(), POLL_MS)
})
onUnmounted(() => clearInterval(timer))
// プッシュ通知アプリを入れに行って戻ってきたら検出し直す
watch(
  () => uiStore.deckResumeSignal,
  () => void push.refresh(),
)

const status = computed(() => push.status.value)
const rows = computed(() => status.value?.accounts ?? [])
const hasDistributor = computed(
  () => status.value !== null && status.value.distributor !== 'none',
)
const canEnable = computed(() =>
  rows.value.some(
    (r) => r.state === 'off' || r.state === 'needsReregistration',
  ),
)
const notArriving = computed(() =>
  rows.value.some((r) => r.awaiting && r.resent),
)

function label(accountId: string): string {
  const account = accountsStore.accounts.find((a) => a.id === accountId)
  return account ? getAccountLabel(account) : accountId
}

// 文言の表。値が増えたら型エラーで気づく
const STATE_TEXT: Record<PushState, () => string> = {
  unavailable: () => i18n.ts._pushRegister._state.unavailable,
  off: () => i18n.ts._pushRegister._state.off,
  preparing: () => i18n.ts._pushRegister._state.preparing,
  pending: () => i18n.ts._pushRegister._state.unexecuted,
  active: () => i18n.ts._pushRegister._state.active,
  needsReregistration: () => i18n.ts._pushRegister._state.needsReregistration,
  unregistering: () => i18n.ts._pushRegister._state.unregistering,
}
const REASON_TEXT: Record<PushReason, () => string> = {
  endpointChanged: () => i18n.ts._pushRegister._reason.endpointChanged,
  serverChanged: () => i18n.ts._pushRegister._reason.serverChanged,
  missing: () => i18n.ts._pushRegister._reason.missing,
  migrated: () => i18n.ts._pushRegister._reason.migrated,
}
const PROBLEM_TEXT: Record<PushProblem, () => string> = {
  unavailable: () => i18n.ts._pushRegister._problem.unavailable,
  serverUnsupported: () => i18n.ts._pushRegister._problem.serverUnsupported,
  noDistributor: () => i18n.ts._pushRegister._problem.noDistributor,
  chooseDistributor: () => i18n.ts._pushRegister._problem.chooseDistributor,
  distributorFailed: () => i18n.ts._pushRegister._problem.distributorFailed,
  endpointUnusable: () => i18n.ts._pushRegister._problem.endpointUnusable,
  relogin: () => i18n.ts._pushRegister._problem.relogin,
  network: () => i18n.ts._pushRegister._problem.network,
  storage: () => i18n.ts._pushRegister._problem.storage,
}

function stateText(row: PushAccountRow): string {
  if (row.state === 'pending' && row.awaiting) {
    return i18n.ts._pushRegister._state.awaiting
  }
  return STATE_TEXT[row.state]()
}

const problemText = computed(() =>
  push.problem.value ? PROBLEM_TEXT[push.problem.value]() : null,
)

// 選べなかったときだけ一覧を出す
watch(
  () => push.problem.value,
  async (problem) => {
    choices.value =
      problem === 'chooseDistributor' ? await push.distributors() : []
  },
)

async function copyAndOpen() {
  const s = status.value
  if (!s?.code) return
  await copyToClipboard(s.code)
  void openSafeUrl(s.scratchpadUrl)
}

async function stop(accountId: string) {
  const ok = await confirm({
    title: i18n.tsx._pushRegister.disableTitle({ user: label(accountId) }),
    message: i18n.ts._pushRegister.disableMessage,
    okLabel: i18n.ts._pushRegister.disable,
    type: 'danger',
  })
  if (ok) await push.disable(accountId)
}
</script>

<template>
  <div :class="$style.content">
    <p :class="$style.hint">{{ i18n.ts._pushRegister.intro }}</p>

    <template v-if="status !== null && !hasDistributor">
      <p :class="$style.notice">{{ i18n.ts._pushRegister.noDistributor }}</p>
      <div :class="$style.btnRow">
        <button class="_button" :class="$style.primaryBtn" @click="openSafeUrl(DISTRIBUTORS_URL)">
          <i class="ti ti-external-link" />
          {{ i18n.ts._pushRegister.getApp }}
        </button>
        <button class="_button" :class="$style.actionBtn" @click="push.refresh()">
          <i class="ti ti-refresh" />
          {{ i18n.ts._pushRegister.checkAgain }}
        </button>
      </div>
    </template>

    <ul v-if="rows.length > 0" :class="$style.rows">
      <li v-for="row in rows" :key="row.accountId" :class="$style.row">
        <div :class="$style.rowText">
          <span :class="$style.rowName">{{ label(row.accountId) }}</span>
          <span :class="$style.rowState">
            <i v-if="row.state === 'active'" class="ti ti-bell-ringing" :class="$style.activeIcon" />
            {{ stateText(row) }}
          </span>
          <span v-if="row.reason && row.state === 'needsReregistration'" :class="$style.rowReason">
            {{ REASON_TEXT[row.reason]() }}
          </span>
        </div>
        <div :class="$style.rowActions">
          <button
            v-if="row.state === 'pending'"
            class="_button"
            :class="$style.rowBtn"
            :disabled="push.busy.value"
            @click="push.redo(row.accountId)"
          >
            {{ i18n.ts._pushRegister.redo }}
          </button>
          <button
            v-if="row.state === 'pending' || row.state === 'active' || row.state === 'needsReregistration'"
            class="_button"
            :class="$style.rowBtnDanger"
            :disabled="push.busy.value"
            @click="stop(row.accountId)"
          >
            {{ i18n.ts._pushRegister.disable }}
          </button>
        </div>
      </li>
    </ul>

    <template v-if="hasDistributor && canEnable">
      <p :class="$style.hint">{{ i18n.ts._pushRegister.howItWorks }}</p>
      <div :class="$style.btnRow">
        <button class="_button" :class="$style.primaryBtn" :disabled="push.busy.value" @click="push.prepare()">
          <i class="ti ti-bell-ringing" />
          {{ push.busy.value ? i18n.ts._pushRegister.waiting : i18n.ts._pushRegister.enable }}
        </button>
      </div>
    </template>

    <div v-if="choices.length > 0" :class="$style.step">
      <span :class="$style.stepTitle">{{ i18n.ts._pushRegister.chooseDistributor }}</span>
      <div :class="$style.choices">
        <button
          v-for="d in choices"
          :key="d.package"
          class="_button"
          :class="$style.actionBtn"
          :disabled="push.busy.value"
          @click="push.choose(d.package)"
        >
          {{ d.label }}
        </button>
      </div>
    </div>

    <div v-if="status?.code" :class="$style.step">
      <button class="_button" :class="[$style.primaryBtn, { [$style.feedback]: copied }]" @click="copyAndOpen">
        <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
        {{ i18n.ts._pushRegister.copyAndOpen }}
      </button>
      <ol :class="$style.steps">
        <li>{{ i18n.ts._pushRegister.step1 }}</li>
        <li>{{ i18n.ts._pushRegister.step2 }}</li>
        <li>{{ i18n.ts._pushRegister.step3 }}</li>
      </ol>
      <details :class="$style.codeDetails">
        <summary>{{ i18n.ts._pushRegister.showCode }}</summary>
        <pre :class="$style.code">{{ status.code }}</pre>
      </details>
    </div>

    <p v-if="notArriving" :class="$style.notice">{{ i18n.ts._pushRegister.notArriving }}</p>

    <div v-if="problemText" :class="$style.error">{{ problemText }}</div>
    <div v-else-if="push.error.value" :class="$style.error">{{ i18n.ts._pushRegister.failed }}</div>

    <button class="_button" :class="$style.docsLink" @click="openSafeUrl(DOCS_URL)">
      <i class="ti ti-book" />
      {{ i18n.ts._pushRegister.learnMore }}
    </button>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  // 行・手順・案内が全部出ると窓の max-height を超える。DeckWindow の本体は
  // overflow: hidden なので、スクロールは中身の側で持つ (PermissionsContent と同じ)
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.hint {
  margin: 0;
  font-size: var(--nd-font-sm);
  line-height: 1.5;
  color: var(--nd-fgMuted);
}

.notice {
  margin: 0;
  padding: 8px 12px;
  font-size: var(--nd-font-sm);
  line-height: 1.5;
  color: var(--nd-fg);
  background: color-mix(in srgb, var(--nd-accent) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--nd-bg);
  border-radius: var(--nd-radius-sm);
}

.rowText {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.rowName {
  overflow: hidden;
  font-size: var(--nd-font-sm);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowState,
.rowReason {
  font-size: var(--nd-font-sm);
  line-height: 1.4;
  color: var(--nd-fgMuted);
}

.activeIcon {
  color: var(--nd-accentText);
}

.rowActions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.rowBtn {
  @include btn-secondary;
}

.rowBtnDanger {
  @include btn-danger-ghost;
  // 共通部品は幅いっぱいに広がるので、行の右端に収める
  width: auto;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stepTitle {
  font-size: var(--nd-font-sm);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fg);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  font-size: var(--nd-font-sm);
  line-height: 1.5;
  color: var(--nd-fg);
  list-style: none;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.codeDetails {
  font-size: var(--nd-font-sm);
  color: var(--nd-fgMuted);
}

.code {
  margin: 8px 0 0;
  padding: 8px 10px;
  max-height: 180px;
  overflow: auto;
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-sm);
  white-space: pre;
  color: var(--nd-fg);
  background: var(--nd-bg);
  border-radius: var(--nd-radius-sm);
}

.btnRow {
  display: flex;
  gap: 8px;
}

.actionBtn {
  @include btn-action;
}

.feedback {
  color: var(--nd-accentText);
}

.primaryBtn {
  @include btn-primary;
  flex: 1;
}

.docsLink {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: var(--nd-font-sm);
  color: var(--nd-accentText);
}

.error {
  padding: 8px 12px;
  font-size: var(--nd-font-sm);
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}
</style>
