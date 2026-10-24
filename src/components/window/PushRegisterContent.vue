<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PushProblem } from '@/bindings'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { usePushRegistration } from '@/composables/usePushRegistration'
import { i18n } from '@/i18n'
import { useConfirm } from '@/stores/confirm'
import { openSafeUrl } from '@/utils/url'

/**
 * 口座ごとの push の登録 (#330 §5、Android)。本家の購読登録はアプリのトークンでは
 * 呼べないので、コードを Web UI の Scratchpad で実行してもらい、表示された応答を
 * ここに貼ってもらう。使わなくても閉じている間は定期確認で届く (オプトイン)。
 */
const props = defineProps<{
  accountId: string
}>()

const DOCS_URL = 'https://notedeck.io/docs/guide/notifications'

const push = usePushRegistration(() => props.accountId)
const { copied, copyToClipboard } = useClipboardFeedback()
const { confirm } = useConfirm()
const response = ref('')

onMounted(() => {
  void push.refresh()
})

const status = computed(() => push.status.value)
const canRegister = computed(
  () =>
    status.value === 'off' ||
    status.value === 'needsRegistration' ||
    status.value === 'actionRequired',
)
// 理由ごとの文言。PushProblem に値が増えたら型エラーで気づく
const PROBLEM_TEXT: Record<PushProblem, () => string> = {
  unavailable: () => i18n.ts._pushRegister._problem.unavailable,
  serverUnsupported: () => i18n.ts._pushRegister._problem.serverUnsupported,
  noDistributor: () => i18n.ts._pushRegister._problem.noDistributor,
  distributorFailed: () => i18n.ts._pushRegister._problem.distributorFailed,
  unreadable: () => i18n.ts._pushRegister._problem.unreadable,
  otherAccount: () => i18n.ts._pushRegister._problem.otherAccount,
  otherEndpoint: () => i18n.ts._pushRegister._problem.otherEndpoint,
  endpointGone: () => i18n.ts._pushRegister._problem.endpointGone,
  storage: () => i18n.ts._pushRegister._problem.storage,
}
const problemText = computed(() =>
  push.problem.value ? PROBLEM_TEXT[push.problem.value]() : null,
)

async function start() {
  response.value = ''
  await push.prepare()
}

async function submit() {
  if (await push.complete(response.value.trim())) response.value = ''
}

async function stop() {
  const ok = await confirm({
    title: i18n.ts._pushRegister.disableTitle,
    message: i18n.ts._pushRegister.disableMessage,
    okLabel: i18n.ts._pushRegister.disable,
    type: 'danger',
  })
  if (ok) await push.disable()
}

function copyCode() {
  if (push.prepared.value) void copyToClipboard(push.prepared.value.code)
}

function openScratchpad() {
  if (push.prepared.value) void openSafeUrl(push.prepared.value.scratchpadUrl)
}
</script>

<template>
  <div :class="$style.content">
    <template v-if="status === 'unavailable'">
      <p :class="$style.hint">{{ i18n.ts._pushRegister._problem.unavailable }}</p>
    </template>

    <template v-else-if="status === 'active'">
      <p :class="$style.lead">
        <i class="ti ti-bell-ringing" :class="$style.leadIcon" />
        {{ i18n.ts._pushRegister.active }}
      </p>
      <div :class="$style.btnRow">
        <button class="_button" :class="$style.dangerBtn" :disabled="push.busy.value" @click="stop">
          <i class="ti ti-bell-off" />
          {{ i18n.ts._pushRegister.disable }}
        </button>
      </div>
    </template>

    <template v-else-if="status !== null">
      <p :class="$style.hint">{{ i18n.ts._pushRegister.intro }}</p>

      <p v-if="status === 'noDistributor'" :class="$style.notice">
        {{ i18n.ts._pushRegister.noDistributor }}
      </p>
      <p v-else-if="status === 'needsRegistration'" :class="$style.notice">
        {{ i18n.ts._pushRegister.needsRegistration }}
      </p>
      <p v-else-if="status === 'actionRequired'" :class="$style.notice">
        {{ i18n.ts._pushRegister.actionRequired }}
      </p>

      <template v-if="canRegister">
        <p :class="$style.hint">{{ i18n.ts._pushRegister.howItWorks }}</p>
        <div :class="$style.btnRow">
          <button class="_button" :class="$style.primaryBtn" :disabled="push.busy.value" @click="start">
            <i class="ti ti-player-play" />
            {{ push.busy.value && !push.prepared.value ? i18n.ts._pushRegister.waiting : i18n.ts._pushRegister.start }}
          </button>
        </div>

        <template v-if="push.prepared.value">
          <div :class="$style.step">
            <span :class="$style.stepTitle">{{ i18n.ts._pushRegister.stepRun }}</span>
            <pre :class="$style.code">{{ push.prepared.value.code }}</pre>
            <div :class="$style.btnRow">
              <button class="_button" :class="[$style.actionBtn, { [$style.feedback]: copied }]" @click="copyCode">
                <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
                {{ copied ? i18n.ts._common.copied : i18n.ts._pushRegister.copyCode }}
              </button>
              <button class="_button" :class="$style.actionBtn" @click="openScratchpad">
                <i class="ti ti-external-link" />
                {{ i18n.ts._pushRegister.openScratchpad }}
              </button>
            </div>
          </div>

          <div :class="$style.step">
            <span :class="$style.stepTitle">{{ i18n.ts._pushRegister.stepPaste }}</span>
            <textarea
              v-model="response"
              :class="$style.textarea"
              :placeholder="i18n.ts._pushRegister.responsePlaceholder"
              spellcheck="false"
              autocapitalize="off"
            />
            <div :class="$style.btnRow">
              <button
                class="_button"
                :class="$style.primaryBtn"
                :disabled="push.busy.value || response.trim() === ''"
                @click="submit"
              >
                <i class="ti ti-check" />
                {{ i18n.ts._pushRegister.submit }}
              </button>
            </div>
          </div>
        </template>
      </template>
    </template>

    <div v-if="problemText" :class="$style.error">{{ problemText }}</div>
    <div v-else-if="push.error.value" :class="$style.error">{{ i18n.ts._pushRegister.failed }}</div>

    <button v-if="status !== null && status !== 'unavailable'" class="_button" :class="$style.docsLink" @click="openSafeUrl(DOCS_URL)">
      <i class="ti ti-book" />
      {{ i18n.ts._pushRegister.learnMore }}
    </button>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/inputs' as *;

.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
}

.lead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--nd-font-body);
  color: var(--nd-fg);
}

.leadIcon {
  font-size: 18px;
  color: var(--nd-accentText);
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

.code {
  margin: 0;
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

.textarea {
  @include input-base;
  min-height: 96px;
  padding: 8px 10px;
  resize: vertical;
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-sm);
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

.dangerBtn {
  @include btn-danger;
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
