<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  PushAccountRow,
  PushDistributor,
  PushHostStatus,
  PushProblem,
  PushReason,
  PushState,
} from '@/bindings'
import AccountAvatar from '@/components/common/AccountAvatar.vue'
import AccountPickerRow from '@/components/common/AccountPickerRow.vue'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { usePushRegistration } from '@/composables/usePushRegistration'
import { i18n } from '@/i18n'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useUiStore } from '@/stores/ui'
import { openSafeUrl } from '@/utils/url'

/**
 * push の設定 (#330、Android。入口は設定メニュー)。上にプッシュ通知アプリの候補 (接続や
 * ペットと同じカード、端末で 1 つ)、下に全アカウント (ほかの画面と同じアカウントの行)。
 * 行を押すとオン / オフが切り替わる。本家の購読登録はアプリのトークンでは呼べないので、
 * オンにすると NoteDeck が送り先をレジストリに書き、利用者はサーバーごとのコードを本家
 * Web のスクラッチパッドで ▶ するだけ。届いた push で確定するので応答の貼り戻しは無い。
 * 窓を開いている間は数秒おきに読み直して進み具合を出す。使わなくても閉じている間は
 * 定期確認で届く (オプトイン)。
 */

const DOCS_URL = 'https://notedeck.io/docs/guide/notifications'
const DISTRIBUTORS_URL = 'https://unifiedpush.org/users/distributors/'
const POLL_MS = 10_000

const push = usePushRegistration()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()
const { copied, copyToClipboard } = useClipboardFeedback()
const { confirm } = useConfirm()
/** 今オン / オフを切り替えている行 (行の右端に待ちの印を出す) */
const acting = ref<string | null>(null)

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
const apps = computed(() => status.value?.apps ?? [])
// ゲストは通知を持たないので出さない
const rows = computed(() =>
  (status.value?.hosts ?? [])
    .flatMap((h) => h.accounts)
    .filter((r) => {
      const a = account(r.accountId)
      return a !== undefined && !isGuestAccount(a)
    }),
)
/** 未実行の登録待ちがあるサーバー (サーバーごとに 1 つのコード) */
const codes = computed(() =>
  (status.value?.hosts ?? []).filter(
    (h): h is PushHostStatus & { code: string } => h.code !== null,
  ),
)
const canEnable = computed(() => rows.value.some((r) => turnsOn(r.state)))
const notArriving = computed(() =>
  rows.value.some((r) => r.awaiting && r.resent),
)

function account(accountId: string) {
  return accountsStore.accounts.find((a) => a.id === accountId)
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

/** 押すとオンにする状態 */
function turnsOn(state: PushState): boolean {
  return state === 'off' || state === 'needsReregistration'
}

/** 押すとオフにする状態 */
function turnsOff(state: PushState): boolean {
  return state === 'pending' || state === 'active'
}

function rowHint(row: PushAccountRow): string {
  const state =
    row.state === 'pending' && row.awaiting
      ? i18n.ts._pushRegister._state.awaiting
      : STATE_TEXT[row.state]()
  if (row.state === 'needsReregistration' && row.reason) {
    return `${state} — ${REASON_TEXT[row.reason]()}`
  }
  return state
}

const problemText = computed(() =>
  push.problem.value ? PROBLEM_TEXT[push.problem.value]() : null,
)

async function toggle(row: PushAccountRow) {
  acting.value = row.accountId
  try {
    if (turnsOn(row.state)) {
      await push.prepare(row.accountId)
      return
    }
    if (!turnsOff(row.state)) return
    const target = account(row.accountId)
    const ok = await confirm({
      title: i18n.tsx._pushRegister.disableTitle({
        user: target ? getAccountLabel(target) : row.accountId,
      }),
      message: i18n.ts._pushRegister.disableMessage,
      okLabel: i18n.ts._pushRegister.disable,
      type: 'danger',
    })
    if (ok) await push.disable(row.accountId)
  } finally {
    acting.value = null
  }
}

async function pickApp(app: PushDistributor) {
  if (app.active) return
  // 使っているアカウントがあれば、切り替えると登録し直しが要る
  if (rows.value.some((r) => turnsOff(r.state))) {
    const ok = await confirm({
      title: i18n.ts._pushRegister.switchTitle,
      message: i18n.ts._pushRegister.switchMessage,
    })
    if (!ok) return
  }
  await push.choose(app.package)
}

const copiedHost = ref<string | null>(null)

async function copyAndOpen(host: PushHostStatus & { code: string }) {
  copiedHost.value = host.host
  await copyToClipboard(host.code)
  void openSafeUrl(host.scratchpadUrl)
}
</script>

<template>
  <div :class="$style.content">
    <p :class="$style.hint">{{ i18n.ts._pushRegister.intro }}</p>

    <!-- プッシュ通知アプリの候補 (接続やペットと同じカード) -->
    <section :class="$style.section">
      <div :class="$style.heading">
        <i class="ti ti-apps" />
        <span>{{ i18n.ts._pushRegister.apps }}</span>
      </div>
      <ChoiceCardGrid v-if="apps.length > 0">
        <ChoiceCard
          v-for="app in apps"
          :key="app.package"
          icon="bell-ringing"
          :label="app.label"
          :title="app.package"
          :active="app.active"
          :disabled="push.busy.value"
          @click="pickApp(app)"
        />
      </ChoiceCardGrid>
      <p v-else-if="status !== null" :class="$style.notice">
        {{ i18n.ts._pushRegister.noDistributor }}
      </p>
      <p v-if="push.problem.value === 'chooseDistributor' && apps.length > 0" :class="$style.hint">
        {{ i18n.ts._pushRegister.chooseDistributor }}
      </p>
      <button type="button" :class="$style.link" @click="openSafeUrl(DISTRIBUTORS_URL)">
        <i class="ti ti-external-link" />
        {{ i18n.ts._pushRegister.getApp }}
      </button>
    </section>

    <!-- このサーバーのアカウント (ほかの画面と同じアカウントの行)。押すとオン / オフ -->
    <section v-if="rows.length > 0" :class="$style.section">
      <div :class="$style.heading">
        <i class="ti ti-users" />
        <span>{{ i18n.ts._pushRegister.accounts }}</span>
      </div>
      <div :class="$style.rows">
        <AccountPickerRow
          v-for="row in rows"
          :key="row.accountId"
          :label="getAccountLabel(account(row.accountId)!)"
          :hint="rowHint(row)"
          :disabled="push.busy.value || !(turnsOn(row.state) || turnsOff(row.state))"
          @click="toggle(row)"
        >
          <template #avatar>
            <AccountAvatar
              :src="getAccountAvatarUrl(account(row.accountId)!)"
              :host="account(row.accountId)!.host"
              :size="32"
            />
          </template>
          <template #trailing>
            <i v-if="acting === row.accountId && push.busy.value" class="ti ti-loader-2" :class="[$style.trailing, $style.spin]" />
            <span v-else-if="turnsOn(row.state)" :class="[$style.trailing, $style.turnOn]">
              {{ i18n.ts._pushRegister.enable }}
            </span>
            <span v-else-if="turnsOff(row.state)" :class="[$style.trailing, $style.turnOff]">
              {{ i18n.ts._pushRegister.disable }}
            </span>
          </template>
        </AccountPickerRow>
      </div>
      <p v-if="canEnable" :class="$style.hint">{{ i18n.ts._pushRegister.howItWorks }}</p>
    </section>

    <!-- 未実行の登録待ちがあるサーバーごとのコード (同じサーバーのアカウントはまとめて 1 つ) -->
    <div v-if="codes.length > 0" :class="$style.section">
      <template v-for="h in codes" :key="h.host">
        <span v-if="codes.length > 1" :class="$style.codeHost">{{ h.host }}</span>
        <button
          class="_button"
          :class="[$style.primaryBtn, { [$style.feedback]: copied && copiedHost === h.host }]"
          @click="copyAndOpen(h)"
        >
          <i :class="copied && copiedHost === h.host ? 'ti ti-check' : 'ti ti-copy'" />
          {{ i18n.ts._pushRegister.copyAndOpen }}
        </button>
        <details :class="$style.codeDetails">
          <summary>{{ i18n.ts._pushRegister.showCode }}</summary>
          <pre :class="$style.code">{{ h.code }}</pre>
        </details>
      </template>
      <ol :class="$style.steps">
        <li>{{ i18n.ts._pushRegister.step1 }}</li>
        <li>{{ i18n.ts._pushRegister.step2 }}</li>
        <li>{{ i18n.ts._pushRegister.step3 }}</li>
      </ol>
    </div>

    <p v-if="notArriving" :class="$style.notice">{{ i18n.ts._pushRegister.notArriving }}</p>

    <div v-if="problemText && push.problem.value !== 'chooseDistributor'" :class="$style.error">{{ problemText }}</div>
    <div v-else-if="push.error.value" :class="$style.error">{{ i18n.ts._pushRegister.failed }}</div>

    <button type="button" :class="$style.link" @click="openSafeUrl(DOCS_URL)">
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
  gap: 16px;
  // 中身が窓の max-height を超える。DeckWindow の本体は overflow: hidden なので、
  // スクロールは中身の側で持つ (PermissionsContent と同じ)
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

// ペットや接続の設定と同じ見出し
.heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--nd-font-md);
  color: var(--nd-fg);
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
  margin: 0 -12px;
}

.trailing {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--nd-font-sm);
}

.turnOn {
  color: var(--nd-accentText);
}

.turnOff {
  color: var(--nd-fgMuted);
}

.spin {
  display: inline-block;
  animation: kf-spin 1s linear infinite;
}

@keyframes kf-spin {
  to {
    transform: rotate(360deg);
  }
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

.codeHost {
  font-size: var(--nd-font-sm);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fg);
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

.feedback {
  color: var(--nd-accentText);
}

.primaryBtn {
  @include btn-primary;
}

// ペットの「探す」と同じリンク
.link {
  @include nd-interactive;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: var(--nd-font-xs);
  color: var(--nd-fgMuted);
  cursor: pointer;

  &:hover {
    color: var(--nd-accentText);
  }
}

.error {
  padding: 8px 12px;
  font-size: var(--nd-font-sm);
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}
</style>
