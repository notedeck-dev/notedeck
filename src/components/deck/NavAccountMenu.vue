<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNavigation } from '@/composables/useNavigation'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { type Account, isGuestAccount } from '@/stores/accounts'
import { modeIcon, modeLabel } from '@/utils/customTimelines'
import { hapticSelection } from '@/utils/haptics'
import { openSafeUrl, webUiUrl } from '@/utils/url'

const props = defineProps<{
  show: boolean
  account: Account
  modes: Record<string, boolean>
  togglingMode: boolean
  modeError: string | null
  isAdmin: boolean
}>()

const { visible: menuVisible, leaving: menuLeaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 180, leaveDuration: 180 },
)

const emit = defineEmits<{
  'toggle-mode': [key: string]
  logout: []
  relogin: [host: string]
  'clear-cache': []
  close: []
}>()

const { navigateToUser } = useNavigation()
const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => menuVisible.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 180,
  },
)

const hasUpperSection = computed(
  () =>
    (props.account.hasToken && Object.keys(props.modes).length > 0) ||
    !isGuestAccount(props.account) ||
    props.isAdmin,
)
</script>

<template>
  <dialog
    v-if="menuVisible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, menuLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <div
      autofocus
      tabindex="-1"
      class="_popupMenu"
      :class="[$style.navAccountMenu, menuLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
      @click.stop
    >
      <template v-if="account.hasToken && Object.keys(modes).length > 0">
        <button
          v-for="(val, key) in modes"
          :key="key"
          class="_button"
          :class="[$style.navAccountMenuItem, { [$style.modeActive]: val }]"
          :disabled="togglingMode"
          @click="hapticSelection(); emit('toggle-mode', key as string)"
          @keydown.enter="emit('toggle-mode', key as string)"
        >
          <span :class="$style.navAccountMenuLabel">{{ modeLabel(key as string) }}</span>
          <i :class="['ti', `ti-${modeIcon(key as string, val)}`]" />
        </button>
      </template>
      <div v-if="modeError" :class="$style.navAccountMenuError">{{ modeError }}</div>
      <template v-if="!isGuestAccount(account)">
        <div v-if="account.hasToken && Object.keys(modes).length > 0" :class="$style.navAccountMenuDivider" />
        <button class="_button" :class="$style.navAccountMenuItem" @click="navigateToUser(account.id, account.userId)">
          <span>プロフィール</span>
          <i class="ti ti-user" />
        </button>
        <div :class="$style.navAccountMenuDivider" />
        <button class="_button" :class="$style.navAccountMenuItem" @click="openSafeUrl(webUiUrl(account.host, '/settings'))">
          <span>設定</span>
          <i class="ti ti-external-link" />
        </button>
      </template>
      <button v-if="isAdmin" class="_button" :class="$style.navAccountMenuItem" @click="openSafeUrl(webUiUrl(account.host, '/admin'))">
        <span>コントロールパネル</span>
        <i class="ti ti-external-link" />
      </button>

      <div v-if="hasUpperSection" :class="$style.navAccountMenuDivider" />
      <button class="_button" :class="$style.navAccountMenuItem" @click="emit('clear-cache')">
        <span>キャッシュ削除</span>
        <i class="ti ti-eraser" />
      </button>
      <template v-if="account.hasToken">
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountLogout]" @click="emit('logout')">
          <span>ログアウト</span>
          <i class="ti ti-logout" />
        </button>
      </template>
      <template v-else-if="isGuestAccount(account)">
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountLogout]" @click="emit('logout')">
          <span>データを削除</span>
          <i class="ti ti-trash" />
        </button>
      </template>
      <template v-else>
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountRelogin]" @click="emit('relogin', account.host)">
          <span>再ログイン</span>
          <i class="ti ti-login" />
        </button>
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountLogout]" @click="emit('logout')">
          <span>データを削除</span>
          <i class="ti ti-trash" />
        </button>
      </template>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.navAccountMenu {
  width: 100%;
  margin: 0;
  padding: 8px 0 calc(8px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));
  min-width: 0;
  border-radius: 16px 16px 0 0;
  background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
  max-height: 80vh;
  overflow-y: auto;

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.navAccountMenuItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px;
  min-height: 44px;
  cursor: pointer;
  transition: background var(--nd-duration-fast);
  font-size: 0.9em;
  color: var(--nd-fg);
  width: 100%;
  text-align: left;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.modeActive {
  color: var(--nd-accent, #86b300);
}

.navAccountMenuLabel {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.navAccountMenuDivider {
  height: 1px;
  background: var(--nd-divider);
  margin: 4px 0;
}

.navAccountMenuError {
  padding: 6px 14px;
  font-size: 0.75em;
  color: var(--nd-love);
  word-break: break-word;
}

.navAccountLogout {
  color: var(--nd-love, #ff6b6b);
  gap: 8px;

  .ti {
    flex-shrink: 0;
    opacity: 0.8;
  }
}

.navAccountRelogin {
  color: var(--nd-accent);
  gap: 8px;

  .ti {
    flex-shrink: 0;
  }
}
</style>
