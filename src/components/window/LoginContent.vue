<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MisskeyAuth } from '@/adapters/misskey/auth'
import type { AuthSession } from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useServerPreview } from '@/composables/useServerPreview'
import { useVaporTransitionSwitch } from '@/composables/useVaporTransition'
import { detectServer } from '@/core/server'
import type { Account } from '@/stores/accounts'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import { useIsCompactLayout } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { openSafeUrl } from '@/utils/url'

const props = defineProps<{
  initialHost?: string
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const isCompact = useIsCompactLayout()
const auth = new MisskeyAuth()

const host = ref(props.initialHost ?? '')
const {
  status: serverStatus,
  serverInfo,
  errorMessage: previewError,
} = useServerPreview(host)
const step = ref<'input' | 'waiting' | 'guestLoading' | 'error'>('input')
const errorMessage = ref('')
let currentSession: AuthSession | null = null

// Vapor-compatible transition switches (replaces <Transition mode="out-in">)
const stepSwitch = useVaporTransitionSwitch(step, { leaveDuration: 0 })

const logoSrc = computed(() =>
  serverStatus.value === 'ok' && serverInfo.value?.iconUrl
    ? serverInfo.value.iconUrl
    : 'default',
)
const logoSwitch = useVaporTransitionSwitch(logoSrc, { leaveDuration: 200 })

const subtitleSwitch = useVaporTransitionSwitch(serverStatus, {
  leaveDuration: 200,
})

function normalizeHost(): string {
  return host.value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

async function startLogin() {
  const trimmedHost = normalizeHost()
  if (!trimmedHost) return

  try {
    step.value = 'waiting'
    currentSession = await auth.startAuth(trimmedHost)
    await openSafeUrl(currentSession.url)
  } catch (e) {
    step.value = 'error'
    errorMessage.value = AppError.from(e).message
  }
}

async function completeLogin() {
  if (!currentSession) return

  try {
    const serverInfo = await detectServer(currentSession.host)
    // 古い DB キャッシュ (判定ロジック変更前の features など) を、最新検出
    // 結果で即上書きする。これをしないと以降の getServerInfo が stale な
    // features.scheduledNotes = false 等を返し続ける。
    await serversStore.refreshServer(serverInfo)
    const account = unwrap(
      await commands.authCompleteAndSave(currentSession, serverInfo.software),
    ) as unknown as Account

    accountsStore.addAccount(account)
    emit('success')
  } catch (e) {
    step.value = 'error'
    errorMessage.value = AppError.from(e).message
  }
}

async function startGuest() {
  const trimmedHost = normalizeHost()
  if (!trimmedHost) return

  try {
    step.value = 'guestLoading'
    const serverInfo = await detectServer(trimmedHost)
    await serversStore.refreshServer(serverInfo)
    const account = unwrap(
      await commands.createGuestAccount(trimmedHost, serverInfo.software),
    ) as unknown as Account
    accountsStore.addAccount(account)
    emit('success')
  } catch (e) {
    step.value = 'error'
    errorMessage.value = AppError.from(e).message
  }
}

function reset() {
  step.value = 'input'
  errorMessage.value = ''
  currentSession = null
}

onMounted(() => {
  if (props.initialHost) {
    startLogin()
  }
})
</script>

<template>
  <div :class="[$style.loginContent, { [$style.mobile]: isCompact }]">
    <!-- Step 1: Input -->
    <div
      v-if="stepSwitch.displayed.value === 'input'"
      :class="$style.dialogBody"
    >
      <div :class="$style.logoArea">
        <img
          v-if="logoSwitch.displayed.value !== 'default'"
          :key="logoSwitch.displayed.value"
          :src="logoSwitch.displayed.value"
          alt=""
          :class="[$style.appLogo, logoSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
          @error="($event.target as HTMLImageElement).src = '/favicon.svg'"
        />
        <img
          v-else
          key="default"
          src="/favicon.svg"
          alt="NoteDeck"
          :class="[$style.appLogo, logoSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
        />
        <p
          v-if="subtitleSwitch.displayed.value === 'checking'"
          :class="[$style.subtitle, subtitleSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
        >確認中...</p>
        <p
          v-else-if="subtitleSwitch.displayed.value === 'ok'"
          :class="[$style.subtitle, $style.subtitleOk, subtitleSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
        >
          サーバーに接続できます
        </p>
        <p
          v-else-if="subtitleSwitch.displayed.value === 'unsupported'"
          :class="[$style.subtitle, $style.subtitleWarn, subtitleSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
        >
          {{ previewError }}
        </p>
        <p
          v-else-if="subtitleSwitch.displayed.value === 'error'"
          :class="[$style.subtitle, $style.subtitleError, subtitleSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
        >
          {{ previewError }}
        </p>
        <p
          v-else
          :class="[$style.subtitle, subtitleSwitch.leaving.value ? $style.logoLeave : $style.logoEnter]"
        >Misskeyサーバーに接続</p>
      </div>

      <div :class="$style.formArea">
        <label :class="$style.inputLabel" for="host">サーバーアドレス</label>
        <input
          id="host"
          v-model="host"
          type="text"
          :class="$style.mkInput"
          placeholder="misskey.io"
          autocomplete="off"
          @keyup.enter="startLogin"
        />
      </div>

      <div :class="$style.actions">
        <button
          :class="$style.btnLogin"
          :disabled="!host.trim()"
          :title="!host.trim() ? 'ホスト名を入力してください' : ''"
          @click="startLogin"
        >
          ログイン
        </button>
        <button
          :class="$style.btnGuest"
          :disabled="!host.trim()"
          :title="!host.trim() ? 'ホスト名を入力してください' : ''"
          @click="startGuest"
        >
          ゲストとして閲覧
        </button>
        <button class="_button" :class="$style.btnCancel" @click="emit('close')">
          キャンセル
        </button>
      </div>
    </div>

    <!-- Step 2a: Guest loading -->
    <div
      v-else-if="stepSwitch.displayed.value === 'guestLoading'"
      :class="$style.dialogBody"
    >
      <div :class="$style.logoArea">
        <LoadingSpinner />
        <p :class="$style.subtitle">サーバーに接続中...</p>
      </div>
    </div>

    <!-- Step 2: Waiting -->
    <div
      v-else-if="stepSwitch.displayed.value === 'waiting'"
      :class="$style.dialogBody"
    >
      <div :class="$style.logoArea">
        <LoadingSpinner />
        <p :class="$style.subtitle">認証待ち...</p>
      </div>

      <div :class="$style.waitingInfo">
        <p>ブラウザで認証画面が開きました。</p>
        <p>認証が完了したら、下のボタンをクリックしてください。</p>
      </div>

      <div :class="$style.actions">
        <button :class="$style.btnLogin" @click="completeLogin">
          認証しました
        </button>
        <button class="_button" :class="$style.btnCancel" @click="reset">
          キャンセル
        </button>
      </div>
    </div>

    <!-- Step 3: Error -->
    <div
      v-else-if="stepSwitch.displayed.value === 'error'"
      :class="$style.dialogBody"
    >
      <div :class="$style.logoArea">
        <div :class="$style.errorIconWrap">
          <i class="ti ti-alert-triangle" />
        </div>
      </div>

      <p :class="$style.errorText">{{ errorMessage }}</p>

      <div :class="$style.actions">
        <button :class="$style.btnLogin" @click="reset">
          やり直す
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.loginContent {
  height: 100%;
  overflow-y: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialogBody {
  padding: 32px;
}

.logoArea {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.appLogo {
  width: 48px;
  height: 48px;
  border-radius: 10px;
}

.subtitle {
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.7;
}

.subtitleOk {
  color: var(--nd-accent);
  opacity: 1;
}

.subtitleWarn {
  color: var(--nd-warn, #f0a020);
  opacity: 1;
}

.subtitleError {
  color: var(--nd-love);
  opacity: 1;
}

.formArea {
  margin-bottom: 24px;
}

.inputLabel {
  display: block;
  font-size: 0.85em;
  font-weight: bold;
  padding: 0 0 8px 2px;
  color: var(--nd-fg);
}

.mkInput {
  display: block;
  width: 100%;
  height: 42px;
  padding: 0 14px;
  font-size: 1em;
  font-family: inherit;
  color: var(--nd-fg);
  background: transparent;
  border: solid 1px var(--nd-inputBorder, var(--nd-divider));
  border-radius: var(--nd-radius-md);
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:hover {
    border-color: var(--nd-inputBorderHover);
  }

  &:focus {
    border-color: var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.35;
  }
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.btnLogin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 42px;
  padding: 0 20px;
  border: none;
  border-radius: var(--nd-radius-full);
  background: linear-gradient(90deg, var(--nd-buttonGradateA), var(--nd-buttonGradateB));
  color: var(--nd-fgOnAccent);
  font-size: 0.95em;
  font-weight: bold;
  font-family: inherit;
  cursor: pointer;
  transition: transform var(--nd-duration-base), box-shadow var(--nd-duration-base), opacity var(--nd-duration-base);

  &:hover:not(:disabled) {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(134, 179, 0, 0.3);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.btnGuest {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 42px;
  padding: 0 20px;
  border: 1px solid var(--nd-accent);
  border-radius: var(--nd-radius-full);
  background: transparent;
  color: var(--nd-accent);
  font-size: 0.95em;
  font-weight: bold;
  font-family: inherit;
  cursor: pointer;
  transition: transform var(--nd-duration-base), background var(--nd-duration-base), opacity var(--nd-duration-base);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--nd-accent) 10%, transparent);
    transform: scale(1.02);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.btnCancel {
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.6;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}


.waitingInfo {
  margin-bottom: 24px;
  text-align: center;

  p {
    font-size: 0.9em;
    line-height: 1.6;
    color: var(--nd-fg);
    margin: 0;
  }
}

.errorIconWrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--nd-love-hover);
  color: var(--nd-love);
  font-size: 1.4em;
}

.errorText {
  margin: 0 0 24px;
  text-align: center;
  color: var(--nd-love);
  font-size: 0.9em;
  line-height: 1.5;
}

.mobile {
  .dialogBody {
    padding: 24px 16px;
  }

  .mkInput {
    height: 44px;
    font-size: 1em;
  }

  .btnLogin {
    height: 44px;
  }

  .btnCancel {
    min-height: 44px;
  }
}

/* Logo / subtitle transition animations */
.logoEnter { animation: logoIn 0.2s ease; }
.logoLeave { animation: logoOut 0.2s ease forwards; }
@keyframes logoIn { from { opacity: 0; transform: scale(0.9); } }
@keyframes logoOut { to { opacity: 0; transform: scale(0.9); } }
</style>
